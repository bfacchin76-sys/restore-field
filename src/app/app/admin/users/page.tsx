import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InviteForm } from "./invite-form";
import { SubcontractorInviteForm } from "./subcontractor-invite-form";
import { UserRow } from "./user-row";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");
  if (!can(actor, "user.manage", { id: actor.organizationId })) {
    redirect("/app");
  }

  const [users, pendingInvites] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        lastLoginAt: true,
        totpSecret: true,
      },
    }),
    prisma.verificationToken.findMany({
      where: {
        organizationId: actor.organizationId,
        purpose: "INVITE",
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, payload: true, expiresAt: true },
    }),
  ]);

  const allRoles = Object.values(Role);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Manage who can access this organization.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Invite a teammate</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteForm
            allowedRoles={
              actor.role === "OWNER"
                ? allRoles
                : allRoles.filter((r) => r !== "OWNER")
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Invite a subcontractor</CardTitle>
        </CardHeader>
        <CardContent>
          <SubcontractorInviteForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Team</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Role</th>
                <th className="px-6 py-3">2FA</th>
                <th className="px-6 py-3">Last login</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  actorRole={actor.role}
                  actorId={actor.id}
                  allRoles={allRoles}
                />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {pendingInvites.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pending invites</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {pendingInvites.map((inv) => {
                const payload = inv.payload as { role?: string; name?: string } | null;
                return (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between border-b py-2"
                  >
                    <span>
                      <strong>{payload?.name ?? inv.email}</strong>
                      <span className="text-muted-foreground"> · {inv.email}</span>
                      {payload?.role ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {payload.role.toLowerCase()}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      expires {inv.expiresAt.toLocaleDateString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
