import Link from "next/link";
import { findUsableToken } from "@/lib/auth/tokens";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ResetPasswordForm } from "./reset-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const tokenRow = token ? await findUsableToken(token, "PASSWORD_RESET") : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Set a new password</CardTitle>
          <CardDescription>
            Choose a password of at least 8 characters.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {tokenRow && token ? (
            <ResetPasswordForm token={token} />
          ) : (
            <>
              <Alert variant="destructive">
                <AlertDescription>
                  This reset link is invalid or has expired.
                </AlertDescription>
              </Alert>
              <Link
                href="/forgot-password"
                className="block text-sm font-medium text-primary hover:underline"
              >
                Request a new link →
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
