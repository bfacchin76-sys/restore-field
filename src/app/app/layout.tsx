import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { SignOutButton } from "@/components/sign-out-button";

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

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/app" className="text-sm font-semibold tracking-tight">
            RestoreField
          </Link>
          <span className="text-xs text-muted-foreground">
            {userRow?.organization.name}
          </span>
          <nav className="ml-auto flex items-center gap-4 text-sm">
            <Link href="/app" className="hover:underline">
              Dashboard
            </Link>
            <Link href="/app/account" className="hover:underline">
              Account
            </Link>
            {isAdmin ? (
              <Link href="/app/admin/users" className="hover:underline">
                Admin
              </Link>
            ) : null}
            <span className="text-muted-foreground">
              {userRow?.name} · {user.role.replace("_", " ").toLowerCase()}
            </span>
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
