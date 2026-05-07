import { prisma } from "@/lib/db";

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
  const status = await checkDb();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-xl space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
        <header className="space-y-1">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            RestoreField
          </p>
          <h1 className="text-3xl font-semibold text-card-foreground">
            {status.ok ? "RestoreField is alive" : "RestoreField is starting"}
          </h1>
        </header>

        {status.ok ? (
          <div className="space-y-4">
            <div
              role="status"
              className="flex items-center gap-2 text-sm font-medium text-emerald-600"
            >
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full bg-emerald-500"
              />
              Database connection OK
            </div>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Organizations</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {status.orgCount}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Users</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {status.userCount}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="space-y-3">
            <div
              role="alert"
              className="flex items-center gap-2 text-sm font-medium text-destructive"
            >
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full bg-destructive"
              />
              Database connection failed
            </div>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
              {status.error}
            </pre>
            <p className="text-sm text-muted-foreground">
              Check that <code className="rounded bg-muted px-1">DATABASE_URL</code>{" "}
              points at a running Postgres and that{" "}
              <code className="rounded bg-muted px-1">pnpm db:migrate</code> has
              run.
            </p>
          </div>
        )}

        <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
          Phase 0 — bootstrap. See{" "}
          <code className="rounded bg-muted px-1">RESTOREFIELD_PRD.md</code>{" "}
          §14 for the build plan.
        </footer>
      </div>
    </main>
  );
}
