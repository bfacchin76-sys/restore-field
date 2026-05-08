import Link from "next/link";

export const metadata = { title: "Offline — FieldRestore" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">You&apos;re offline</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Photos, moisture readings, and notes you take now are saved on this
          device and will sync the next time you have signal.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Recently-viewed jobs are still available — open the app and they&apos;ll
          load from the local cache.
        </p>
        <div className="mt-6">
          <Link
            href="/app"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Open FieldRestore
          </Link>
        </div>
      </div>
    </main>
  );
}
