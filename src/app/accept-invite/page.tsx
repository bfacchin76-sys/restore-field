import Link from "next/link";
import { findUsableToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AcceptInviteForm } from "./accept-form";

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const tokenRow = token ? await findUsableToken(token, "INVITE") : null;

  let orgName = "FieldRestore";
  let invitedEmail = "";
  if (tokenRow?.organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: tokenRow.organizationId },
      select: { name: true },
    });
    if (org) orgName = org.name;
    invitedEmail = tokenRow.email;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Join {orgName}</CardTitle>
          <CardDescription>
            {tokenRow
              ? `Set a password to activate ${invitedEmail}.`
              : "This invite is invalid or has expired."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {tokenRow && token ? (
            <AcceptInviteForm token={token} />
          ) : (
            <>
              <Alert variant="destructive">
                <AlertDescription>
                  Ask your admin to send you a fresh invite.
                </AlertDescription>
              </Alert>
              <Link
                href="/login"
                className="block text-sm font-medium text-primary hover:underline"
              >
                Back to sign in →
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
