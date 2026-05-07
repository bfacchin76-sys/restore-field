import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TotpManager } from "./totp-manager";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { name: true, email: true, role: true, totpSecret: true },
  });
  if (!user) redirect("/login");

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">
          Manage your sign-in details.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase text-muted-foreground">Name</div>
            <div>{user.name}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Email</div>
            <div>{user.email}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Role</div>
            <div>{user.role.replace("_", " ").toLowerCase()}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Two-factor authentication</CardTitle>
          <CardDescription>
            Use an authenticator app (1Password, Authy, Google Authenticator,
            …) to add a 6-digit code to your sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TotpManager enabled={Boolean(user.totpSecret)} />
        </CardContent>
      </Card>
    </>
  );
}
