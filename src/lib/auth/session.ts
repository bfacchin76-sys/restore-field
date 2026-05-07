import "server-only";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { ActorUser } from "@/lib/authz";

export async function getSessionUser(): Promise<ActorUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    role: session.user.role,
    organizationId: session.user.organizationId,
    active: session.user.active,
  };
}

/**
 * Re-loads the user from the DB. Use this for sensitive paths where
 * a stale JWT (e.g. role just demoted) would matter — pages that just
 * read the role to render UI can rely on `getSessionUser`.
 */
export async function getSessionUserFresh(): Promise<ActorUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, organizationId: true, active: true },
  });
  return u ?? null;
}

export async function requireUser(): Promise<ActorUser> {
  const u = await getSessionUser();
  if (!u || !u.active) throw new Error("Unauthenticated");
  return u;
}
