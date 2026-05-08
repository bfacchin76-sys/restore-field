"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Status = "online-clear" | "online-syncing" | "queued" | "offline" | "stuck";

interface Stats {
  queued: number;
  syncing: number;
  stuck: number;
  online: boolean;
}

const COLOUR: Record<Status, string> = {
  "online-clear": "bg-emerald-500",
  "online-syncing": "bg-amber-500",
  queued: "bg-amber-500",
  offline: "bg-slate-400",
  stuck: "bg-red-500",
};

const LABEL: Record<Status, string> = {
  "online-clear": "synced",
  "online-syncing": "syncing",
  queued: "queued",
  offline: "offline",
  stuck: "stuck",
};

function statusFor(s: Stats | null): Status {
  if (!s) return "online-clear";
  if (s.stuck > 0) return "stuck";
  if (!s.online) return "offline";
  if (s.syncing > 0) return "online-syncing";
  if (s.queued > 0) return "queued";
  return "online-clear";
}

/**
 * Live sync status pill — green when everything's caught up, amber for
 * pending, red for stuck items, slate for offline. Clicks through to
 * /app/admin/sync. PRD §9.
 *
 * Imports the sync engine dynamically so SSR doesn't try to touch
 * IndexedDB.
 */
export function SyncStatus() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const sync = await import("@/lib/offline/sync");
      sync.startSyncEngine();
      const handler = (s: Stats) => {
        if (!cancelled) setStats(s);
      };
      unsub = sync.subscribe(handler);
    })().catch(() => {});
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, []);

  const status = statusFor(stats);
  const total = (stats?.queued ?? 0) + (stats?.syncing ?? 0) + (stats?.stuck ?? 0);

  return (
    <Link
      href="/app/admin/sync"
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] hover:bg-accent"
      title={`Sync: ${LABEL[status]}${total > 0 ? ` · ${total} item(s)` : ""}`}
    >
      <span
        aria-hidden
        className={`inline-block h-2 w-2 rounded-full ${COLOUR[status]}`}
      />
      <span className="capitalize">{LABEL[status]}</span>
      {total > 0 ? <span className="tabular-nums">{total}</span> : null}
    </Link>
  );
}
