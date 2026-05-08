import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { SignOutButton } from "@/components/sign-out-button";
import { SyncStatus } from "@/components/sync-status";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const userRow = await prisma.user.findUnique({
    where: { id: user.id },
    select: { name: true, email: true, role: true, organization: { select: { name: true } } },
  });

  const isAdmin = user.role === "OWNER" || user.role === "OFFICE_ADMIN";
  const isOwner = user.role === "OWNER";

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/app" className="text-sm font-semibold tracking-tight">
            FieldRestore
          </Link>
          <span className="text-xs text-muted-foreground">
            {userRow?.organization.name}
          </span>
          <nav className="ml-auto flex items-center gap-4 text-sm">
            <Link href="/app" className="hover:underline">
              Dashboard
            </Link>
            <Link href="/app/jobs" className="hover:underline">
              Jobs
            </Link>
            <Link href="/app/customers" className="hover:underline">
              Customers
            </Link>
            <Link href="/app/search" className="hover:underline">
              Search
            </Link>
            <Link href="/app/account" className="hover:underline">
              Account
            </Link>
            {isAdmin ? (
              <Link href="/app/equipment" className="hover:underline">
                Equipment
              </Link>
            ) : null}
            {isAdmin ? (
              <Link href="/app/admin/forms" className="hover:underline">
                Forms
              </Link>
            ) : null}
            {isAdmin ? (
              <Link href="/app/admin/users" className="hover:underline">
                Admin
              </Link>
            ) : null}
            {isOwner ? (
              <Link href="/app/admin/org" className="hover:underline">
                Org
              </Link>
            ) : null}
            {isOwner ? (
              <Link href="/app/admin/import" className="hover:underline">
                Import
              </Link>
            ) : null}
            <span className="text-muted-foreground">
              {userRow?.name} · {user.role.replace("_", " ").toLowerCase()}
            </span>
            <SyncStatus />
            <SignOutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
