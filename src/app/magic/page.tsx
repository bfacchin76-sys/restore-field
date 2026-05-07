import Link from "next/link";
import { signIn } from "@/auth";
import { findUsableToken } from "@/lib/auth/tokens";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default async function MagicLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; auto?: string }>;
}) {
  const { token, auto } = await searchParams;
  const tokenRow = token ? await findUsableToken(token, "MAGIC_LINK") : null;

  // For convenience, allow auto=1 to bypass the confirm step (used by tests
  // and email links that already constitute affirmative action).
  if (tokenRow && auto === "1") {
    await signIn("magic-link", { token, redirectTo: "/app" });
  }

  if (!tokenRow || !token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Sign-in link expired</CardTitle>
            <CardDescription>
              This link is invalid or has been used already.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertDescription>
                Ask the office admin who invited you to send a fresh link.
              </AlertDescription>
            </Alert>
            <Link
              href="/login"
              className="mt-4 block text-sm font-medium text-primary hover:underline"
            >
              Back to sign in →
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  // Affirmative click — call the magic-link credentials provider.
  async function consume() {
    "use server";
    await signIn("magic-link", { token, redirectTo: "/app" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to RestoreField</CardTitle>
          <CardDescription>
            Click below to sign in as <strong>{tokenRow.email}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={consume}>
            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

// Avoid pre-render: the token must be looked up per request.
export const dynamic = "force-dynamic";
