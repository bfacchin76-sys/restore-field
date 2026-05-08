"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ResolvedPreferences } from "@/lib/notifications/preferences";
import { updateNotificationPreferences } from "./notification-actions";

interface Props {
  initial: ResolvedPreferences;
}

const FIELDS: Array<{ key: keyof ResolvedPreferences; label: string; hint: string }> = [
  {
    key: "emailJobStatusChange",
    label: "Job status changes",
    hint: "When a job you're on transitions (Active → Drying → Complete, etc.)",
  },
  {
    key: "emailJobAssigned",
    label: "New job assignments",
    hint: "When you're added to a job's crew.",
  },
  {
    key: "emailReportShared",
    label: "Report shared with adjuster",
    hint: "Confirmation when a teammate emails a report to an external party.",
  },
  {
    key: "emailWeeklyDigest",
    label: "Weekly digest",
    hint: "Monday morning rollup of last week's activity (placeholder; not wired yet).",
  },
];

export function NotificationPreferences({ initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [prefs, setPrefs] = useState<ResolvedPreferences>(initial);
  const [msg, setMsg] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const r = await updateNotificationPreferences(prefs);
      if (r.ok) {
        setMsg("Saved.");
        router.refresh();
      } else {
        setMsg(r.message ?? "Save failed.");
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {FIELDS.map((f) => (
        <label key={f.key} className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={prefs[f.key]}
            onChange={(e) =>
              setPrefs({ ...prefs, [f.key]: e.target.checked })
            }
            className="mt-1"
          />
          <div>
            <div className="text-sm font-medium">{f.label}</div>
            <div className="text-xs text-muted-foreground">{f.hint}</div>
          </div>
        </label>
      ))}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save preferences"}
        </Button>
        {msg && <span className="text-sm text-green-700">{msg}</span>}
      </div>
    </form>
  );
}
