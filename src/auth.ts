import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { Role } from "@prisma/client";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/passwords";
import { verifyTotp } from "@/lib/auth/totp";
import { findUsableToken, markTokenUsed } from "@/lib/auth/tokens";
import { logger } from "@/lib/logger";

/**
 * Auth.js v5 surfaces these as the `code` on `CredentialsSignin` errors.
 * The login page maps them to user-visible copy.
 */
export const AUTH_ERRORS = {
  TOTP_REQUIRED: "TOTP_REQUIRED",
  TOTP_INVALID: "TOTP_INVALID",
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  MAGIC_LINK_INVALID: "MAGIC_LINK_INVALID",
} as const;
export type AuthErrorCode = (typeof AUTH_ERRORS)[keyof typeof AUTH_ERRORS];

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  totp: z.string().trim().optional().default(""),
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Email & password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        totp: { label: "Authenticator code", type: "text" },
      },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new Error(AUTH_ERRORS.INVALID_CREDENTIALS);
        const { email, password, totp } = parsed.data;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) throw new Error(AUTH_ERRORS.INVALID_CREDENTIALS);
        if (!(await verifyPassword(password, user.passwordHash))) {
          throw new Error(AUTH_ERRORS.INVALID_CREDENTIALS);
        }
        if (!user.active) throw new Error(AUTH_ERRORS.ACCOUNT_DISABLED);

        if (user.totpSecret) {
          if (!totp) throw new Error(AUTH_ERRORS.TOTP_REQUIRED);
          if (!verifyTotp(totp, user.totpSecret)) {
            throw new Error(AUTH_ERRORS.TOTP_INVALID);
          }
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        prisma.auditLog
          .create({
            data: {
              userId: user.id,
              action: "auth.login",
              details: { email: user.email, role: user.role },
            },
          })
          .catch((err) => logger.warn({ err }, "audit log failed"));

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organizationId: user.organizationId,
          active: user.active,
        };
      },
    }),
    Credentials({
      id: "magic-link",
      name: "Magic link",
      credentials: { token: { label: "Token", type: "text" } },
      authorize: async (raw) => {
        const token =
          typeof (raw as { token?: unknown }).token === "string"
            ? (raw as { token: string }).token
            : "";
        if (!token) throw new Error(AUTH_ERRORS.MAGIC_LINK_INVALID);

        const row = await findUsableToken(token, "MAGIC_LINK");
        if (!row || !row.organizationId) {
          throw new Error(AUTH_ERRORS.MAGIC_LINK_INVALID);
        }

        const payload = (row.payload ?? {}) as {
          role?: Role;
          name?: string;
          jobId?: string | null;
        };

        const targetUser = await prisma.$transaction(async (tx) => {
          let user = row.userId
            ? await tx.user.findUnique({ where: { id: row.userId } })
            : await tx.user.findUnique({ where: { email: row.email } });

          if (!user) {
            user = await tx.user.create({
              data: {
                email: row.email,
                name: payload.name ?? row.email.split("@")[0],
                role: payload.role ?? Role.SUBCONTRACTOR,
                active: true,
                organizationId: row.organizationId!,
              },
            });
          }

          if (!user.active) throw new Error(AUTH_ERRORS.ACCOUNT_DISABLED);

          if (payload.jobId) {
            await tx.jobAssignment
              .upsert({
                where: { jobId_userId: { jobId: payload.jobId, userId: user.id } },
                create: { jobId: payload.jobId, userId: user.id, role: "subcontractor" },
                update: {},
              })
              .catch(() => {
                /* job may not exist or already assigned — non-fatal */
              });
          }

          await tx.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          });

          return user;
        });

        await markTokenUsed(row.id);

        prisma.auditLog
          .create({
            data: {
              userId: targetUser.id,
              action: "auth.magic_link.consume",
              details: { email: targetUser.email, role: targetUser.role },
            },
          })
          .catch((err) => logger.warn({ err }, "audit log failed"));

        return {
          id: targetUser.id,
          email: targetUser.email,
          name: targetUser.name,
          role: targetUser.role,
          organizationId: targetUser.organizationId,
          active: targetUser.active,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      if (user) {
        token.sub = user.id as string;
        token.role = (user as { role: Role }).role;
        token.organizationId = (user as { organizationId: string }).organizationId;
        token.active = (user as { active: boolean }).active;
      }
      // Allow `update()` from a Server Action to refresh role/active
      // when the admin changes them. Re-read from the DB so we don't
      // trust the client-supplied payload.
      if (trigger === "update" && token.sub) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { role: true, active: true, organizationId: true },
        });
        if (fresh) {
          token.role = fresh.role;
          token.active = fresh.active;
          token.organizationId = fresh.organizationId;
        }
      }
      return token;
    },
  },
  events: {
    async signOut(message) {
      const userId =
        "token" in message && message.token?.sub
          ? message.token.sub
          : undefined;
      if (!userId) return;
      await prisma.auditLog
        .create({
          data: { userId, action: "auth.logout", details: {} },
        })
        .catch((err) => logger.warn({ err }, "audit log failed"));
    },
  },
});
