"use client";

import { useState, useTransition } from "react";
import type { Material, MeterType } from "@prisma/client";
import { bulkCreateReadings } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function BulkReadingsForm({
  jobId,
  rooms,
  materials,
  meterTypes,
}: {
  jobId: string;
  rooms: Array<{ id: string; name: string }>;
  materials: Material[];
  meterTypes: MeterType[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ count: number } | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setDone(null);
        const f = new FormData(e.currentTarget);
        const valuesRaw = String(f.get("values") ?? "");
        const values = valuesRaw
          .split(/[\s,]+/)
          .map((s) => Number(s))
          .filter((n) => Number.isFinite(n));
        if (values.length === 0) {
          setError("Enter at least one numeric reading.");
          return;
        }
        startTransition(async () => {
          try {
            await bulkCreateReadings({
              jobId,
              roomId: (String(f.get("roomId") ?? "") || null) as
                | string
                | null,
              surface: String(f.get("surface") ?? "").trim(),
              material: String(f.get("material") ?? "DRYWALL") as Material,
              meterType: String(f.get("meterType") ?? "PIN") as MeterType,
              scaleType: "PERCENT_MC",
              values,
            });
            setDone({ count: values.length });
            (e.target as HTMLFormElement).reset();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed");
          }
        });
      }}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <div className="space-y-1.5">
        <Label htmlFor="bulk-room">Room</Label>
        <select
          id="bulk-room"
          name="roomId"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">— unassigned —</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bulk-surface">Surface</Label>
        <Input
          id="bulk-surface"
          name="surface"
          required
          placeholder="e.g. Drywall — N wall"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bulk-material">Material</Label>
        <select
          id="bulk-material"
          name="material"
          defaultValue="DRYWALL"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {materials.map((m) => (
            <option key={m} value={m}>
              {m.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bulk-meter">Meter</Label>
        <select
          id="bulk-meter"
          name="meterType"
          defaultValue="PIN"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {meterTypes.map((m) => (
            <option key={m} value={m}>
              {m.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="bulk-values">
          Values (comma- or space-separated)
        </Label>
        <Input
          id="bulk-values"
          name="values"
          required
          placeholder="22.5, 21.8, 19.2, 18.5, 17.0"
        />
        <p className="text-xs text-muted-foreground">
          Up to 50 values. Each becomes a reading on the same surface.
        </p>
      </div>

      {error ? (
        <div className="sm:col-span-2">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      {done ? (
        <div className="sm:col-span-2">
          <Alert variant="success">
            <AlertDescription>Saved {done.count} readings.</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="flex items-end sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save batch"}
        </Button>
      </div>
    </form>
  );
}
