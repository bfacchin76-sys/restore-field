"use client";

import { useTransition } from "react";
import type { Material, MeterType, ScaleType } from "@prisma/client";
import { deleteReading, updateReading } from "./actions";
import { Button } from "@/components/ui/button";

interface ReadingVm {
  id: string;
  roomName: string | null;
  surface: string;
  material: Material;
  meterType: MeterType;
  moistureValue: number;
  scaleType: ScaleType;
  isDryGoal: boolean;
  isInitial: boolean;
  isDry: boolean;
  takenAt: string;
  takenBy: string;
  notes: string | null;
}

export function ReadingList({
  readings,
  canEdit,
}: {
  readings: ReadingVm[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (readings.length === 0) {
    return (
      <p className="px-6 py-8 text-center text-sm text-muted-foreground">
        No readings yet.
      </p>
    );
  }

  // Newest at top
  const rows = [...readings].sort(
    (a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime(),
  );

  return (
    <table className="w-full text-sm">
      <thead className="border-b text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="px-6 py-3">When</th>
          <th className="px-6 py-3">Room</th>
          <th className="px-6 py-3">Surface</th>
          <th className="px-6 py-3">Material · Meter</th>
          <th className="px-6 py-3 text-right">Reading</th>
          <th className="px-6 py-3">Flags</th>
          {canEdit ? <th className="px-6 py-3 text-right" /> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b last:border-b-0">
            <td className="px-6 py-2 text-xs text-muted-foreground">
              {new Date(r.takenAt).toLocaleString()}
            </td>
            <td className="px-6 py-2 text-xs">{r.roomName ?? "—"}</td>
            <td className="px-6 py-2">{r.surface}</td>
            <td className="px-6 py-2 text-xs text-muted-foreground">
              {r.material.replace(/_/g, " ").toLowerCase()} ·{" "}
              {r.meterType.replace(/_/g, " ").toLowerCase()}
            </td>
            <td className="px-6 py-2 text-right tabular-nums">
              <span
                className={
                  r.isDryGoal
                    ? "text-blue-700"
                    : r.isDry
                      ? "text-emerald-700"
                      : ""
                }
              >
                {r.moistureValue.toFixed(1)}
              </span>
              <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                {scaleLabel(r.scaleType)}
              </span>
            </td>
            <td className="px-6 py-2">
              <div className="flex flex-wrap gap-1">
                {r.isDryGoal ? <Tag color="blue">goal</Tag> : null}
                {r.isInitial ? <Tag color="amber">initial</Tag> : null}
                {r.isDry ? <Tag color="emerald">dry</Tag> : null}
              </div>
            </td>
            {canEdit ? (
              <td className="px-6 py-2 text-right">
                {!r.isDryGoal ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        try {
                          await updateReading({
                            readingId: r.id,
                            isDryGoal: true,
                          });
                        } catch (err) {
                          alert(err instanceof Error ? err.message : "Failed");
                        }
                      })
                    }
                    className="mr-2 text-xs font-medium text-primary hover:underline disabled:opacity-50"
                  >
                    Mark goal
                  </button>
                ) : null}
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (!confirm("Delete this reading?")) return;
                    startTransition(async () => {
                      try {
                        await deleteReading({ readingId: r.id });
                      } catch (err) {
                        alert(err instanceof Error ? err.message : "Failed");
                      }
                    });
                  }}
                >
                  Delete
                </Button>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function scaleLabel(scale: ScaleType): string {
  switch (scale) {
    case "PERCENT_MC":
      return "%MC";
    case "PERCENT_WME":
      return "%WME";
    case "RELATIVE_SCALE":
      return "rel";
    case "GPP":
      return "GPP";
  }
}

function Tag({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "blue" | "amber" | "emerald";
}) {
  const palette = {
    blue: "bg-blue-100 text-blue-800",
    amber: "bg-amber-100 text-amber-800",
    emerald: "bg-emerald-100 text-emerald-800",
  } as const;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${palette[color]}`}
    >
      {children}
    </span>
  );
}
