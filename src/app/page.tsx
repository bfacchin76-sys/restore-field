import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

type DbStatus =
  | { ok: true; orgCount: number; userCount: number }
  | { ok: false; error: string };

async function checkDb(): Promise<DbStatus> {
  try {
    const [orgCount, userCount] = await Promise.all([
      prisma.organization.count(),
      prisma.user.count(),
    ]);
    return { ok: true, orgCount, userCount };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function Home() {
  const session = await auth();
  if (session?.user?.id && session.user.active) redirect("/app");

  const status = await checkDb();

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-16">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardDescription>FieldRestore</CardDescription>
          <CardTitle>
            {status.ok ? "FieldRestore is alive" : "FieldRestore is starting"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {status.ok ? (
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
              <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              Database connection OK · {status.orgCount} org · {status.userCount} user(s)
            </div>
          ) : (
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
              {status.error}
            </pre>
          )}
          <div className="flex gap-2">
            <Link
              href="/login"
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Sign in
            </Link>
            <Link
              href="/forgot-password"
              className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
            >
              Forgot password?
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
