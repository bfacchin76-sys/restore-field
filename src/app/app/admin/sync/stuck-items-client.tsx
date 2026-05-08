"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

interface SnapshotRow {
  id: number;
  jobId: string;
  retryCount: number;
  lastError?: string | null;
  createdAt: number;
  description: string;
}

interface Snapshot {
  photos: SnapshotRow[];
  readings: SnapshotRow[];
  notes: SnapshotRow[];
}

type TableId = "queuedPhotos" | "queuedReadings" | "queuedNotes";

export function StuckItemsClient() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pending, startTransition] = useTransition();

  const load = async () => {
    const { listStuckItems } = await import("@/lib/offline/sync");
    const r = await listStuckItems();
    setSnapshot({
      photos: r.photos.map((p) => ({
        id: p.id!,
        jobId: p.jobId,
        retryCount: p.retryCount,
        lastError: p.lastError,
        createdAt: p.createdAt,
        description: `${p.filename} (${p.mimeType}, ${(p.size / 1024).toFixed(0)} KB)`,
      })),
      readings: r.readings.map((p) => ({
        id: p.id!,
        jobId: p.jobId,
        retryCount: p.retryCount,
        lastError: p.lastError,
        createdAt: p.createdAt,
        description: `${p.surface} (${p.material.toLowerCase()}, ${p.moistureValue}%)`,
      })),
      notes: r.notes.map((p) => ({
        id: p.id!,
        jobId: p.jobId,
        retryCount: p.retryCount,
        lastError: p.lastError,
        createdAt: p.createdAt,
        description: p.content.slice(0, 80),
      })),
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sync = await import("@/lib/offline/sync");
      const r = await sync.listStuckItems();
      if (cancelled) return;
      setSnapshot({
        photos: r.photos.map((p) => ({
          id: p.id!,
          jobId: p.jobId,
          retryCount: p.retryCount,
          lastError: p.lastError,
          createdAt: p.createdAt,
          description: `${p.filename} (${p.mimeType}, ${(p.size / 1024).toFixed(0)} KB)`,
        })),
        readings: r.readings.map((p) => ({
          id: p.id!,
          jobId: p.jobId,
          retryCount: p.retryCount,
          lastError: p.lastError,
          createdAt: p.createdAt,
          description: `${p.surface} (${p.material.toLowerCase()}, ${p.moistureValue}%)`,
        })),
        notes: r.notes.map((p) => ({
          id: p.id!,
          jobId: p.jobId,
          retryCount: p.retryCount,
          lastError: p.lastError,
          createdAt: p.createdAt,
          description: p.content.slice(0, 80),
        })),
      });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const retry = (table: TableId, id: number) =>
    startTransition(async () => {
      const sync = await import("@/lib/offline/sync");
      await sync.retryStuckItem(table, id);
      await load();
    });

  const discard = (table: TableId, id: number) =>
    startTransition(async () => {
      if (!confirm("Discard this item permanently?")) return;
      const sync = await import("@/lib/offline/sync");
      await sync.discardStuckItem(table, id);
      await load();
    });

  if (!snapshot) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const total =
    snapshot.photos.length + snapshot.readings.length + snapshot.notes.length;

  if (total === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nothing stuck. Anything captured offline that hasn&apos;t synced yet
        will retry on its own.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Section
        title="Photos"
        rows={snapshot.photos}
        table="queuedPhotos"
        onRetry={retry}
        onDiscard={discard}
        pending={pending}
      />
      <Section
        title="Readings"
        rows={snapshot.readings}
        table="queuedReadings"
        onRetry={retry}
        onDiscard={discard}
        pending={pending}
      />
      <Section
        title="Notes"
        rows={snapshot.notes}
        table="queuedNotes"
        onRetry={retry}
        onDiscard={discard}
        pending={pending}
      />
    </div>
  );
}

function Section({
  title,
  rows,
  table,
  onRetry,
  onDiscard,
  pending,
}: {
  title: string;
  rows: SnapshotRow[];
  table: TableId;
  onRetry: (table: TableId, id: number) => void;
  onDiscard: (table: TableId, id: number) => void;
  pending: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">
        {title} ({rows.length})
      </h3>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p>
                  <strong>{r.description}</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  Job {r.jobId} · {r.retryCount} attempts ·{" "}
                  {new Date(r.createdAt).toLocaleString()}
                </p>
                {r.lastError ? (
                  <p className="mt-1 text-xs text-rose-700">{r.lastError}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => onRetry(table, r.id)}
                >
                  Retry
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => onDiscard(table, r.id)}
                >
                  Discard
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
