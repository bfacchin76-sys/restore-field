"use server";

import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { findUsableToken } from "@/lib/auth/tokens";
import { hashPassword } from "@/lib/auth/passwords";
import { recordAudit } from "@/lib/audit";

const inputSchema = z
  .object({
    token: z.string().min(10),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirm: z.string().min(8),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

export interface AcceptInviteResult {
  ok: boolean;
  message?: string;
}

export async function acceptInvite(
  _prev: AcceptInviteResult,
  formData: FormData,
): Promise<AcceptInviteResult> {
  const parsed = inputSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check your inputs.",
    };
  }
  const { token, password } = parsed.data;

  const row = await findUsableToken(token, "INVITE");
  if (!row || !row.organizationId) {
    return {
      ok: false,
      message: "This invite link is invalid or has expired.",
    };
  }

  const payload = (row.payload ?? {}) as {
    role?: string;
    name?: string;
    invitedById?: string;
  };
  const role: Role =
    payload.role && (Object.values(Role) as string[]).includes(payload.role)
      ? (payload.role as Role)
      : "TECH";
  const name = payload.name ?? row.email.split("@")[0];

  // Race-safe: catch the unique-email collision if the user was created
  // between findUsable and create (very unlikely).
  const passwordHash = await hashPassword(password);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          email: row.email,
          name,
          role,
          active: true,
          passwordHash,
          organizationId: row.organizationId!,
        },
      });
      await tx.verificationToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
    });
  } catch {
    return {
      ok: false,
      message: "Could not create your account. Ask your admin to re-invite.",
    };
  }

  await recordAudit("user.accept_invite", {
    actor: { userId: payload.invitedById ?? "system" },
    jobId: null,
  }, {
    email: row.email,
    role,
  });

  return {
    ok: true,
    message:
      "Your account is ready. Sign in with the password you just chose.",
  };
}
