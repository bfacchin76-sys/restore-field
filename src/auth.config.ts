/**
 * Edge-safe Auth.js v5 config. Imported by both the full auth (`src/auth.ts`,
 * Node runtime, has DB + bcrypt) and by middleware (Edge runtime, no Node
 * modules). Anything inside this file MUST be Edge-compatible.
 */
import type { NextAuthConfig } from "next-auth";
import type {} from "next-auth/jwt";
import type { Role } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      organizationId: string;
      active: boolean;
      email?: string | null;
      name?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sub: string;
    role: Role;
    organizationId: string;
    active: boolean;
  }
}

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  providers: [], // populated in src/auth.ts
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      const isApp = path.startsWith("/app");
      if (isApp) return Boolean(auth?.user?.id && auth.user.active);
      return true;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = token.role as Role;
        session.user.organizationId = token.organizationId as string;
        session.user.active = token.active as boolean;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
