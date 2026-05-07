"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import type { Material, MeterType } from "@prisma/client";
import { createReading, type ReadingActionResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initial: ReadingActionResult = { ok: false };

interface ReadingFormProps {
  jobId: string;
  rooms: Array<{ id: string; name: string }>;
  surfaceSuggestions: string[];
  materials: Material[];
  meterTypes: MeterType[];
}

export function ReadingForm({
  jobId,
  rooms,
  surfaceSuggestions,
  materials,
  meterTypes,
}: ReadingFormProps) {
  const [state, formAction, pending] = useActionState(createReading, initial);
  const valueRef = useRef<HTMLInputElement | null>(null);
  const datalistId = useId();

  // After a successful submit, refocus the value input so the next reading
  // can be punched in immediately. PRD §14 DoD: <10s per reading.
  useEffect(() => {
    if (state.ok) valueRef.current?.focus();
  }, [state.ok]);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="jobId" value={jobId} />

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="rf-room">Room</Label>
        <select
          id="rf-room"
          name="roomId"
          defaultValue={state.roomId ?? ""}
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

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="rf-surface">Surface</Label>
        <Input
          id="rf-surface"
          name="surface"
          defaultValue={state.surface ?? ""}
          list={datalistId}
          placeholder="e.g. Drywall — N wall"
          required
        />
        <datalist id={datalistId}>
          {surfaceSuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {state.fieldErrors?.surface ? (
          <p className="text-xs font-medium text-destructive">
            {state.fieldErrors.surface}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rf-material">Material</Label>
        <select
          id="rf-material"
          name="material"
          required
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
        <Label htmlFor="rf-meter">Meter</Label>
        <select
          id="rf-meter"
          name="meterType"
          required
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

      <div className="space-y-1.5">
        <Label htmlFor="rf-value">Reading (%MC)</Label>
        <Input
          ref={valueRef}
          id="rf-value"
          name="moistureValue"
          type="number"
          step="0.1"
          inputMode="decimal"
          required
          autoFocus
          placeholder="22.5"
        />
        {state.fieldErrors?.moistureValue ? (
          <p className="text-xs font-medium text-destructive">
            {state.fieldErrors.moistureValue}
          </p>
        ) : null}
      </div>

      <div className="flex items-end gap-3 sm:col-span-1">
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            name="isDryGoal"
            value="true"
            className="h-4 w-4 rounded border-input"
          />
          Dry goal
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            name="isInitial"
            value="true"
            className="h-4 w-4 rounded border-input"
          />
          Initial
        </label>
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="rf-notes">Notes (optional)</Label>
        <Input id="rf-notes" name="notes" placeholder="e.g. behind oven" />
      </div>

      {state.message ? (
        <div className="sm:col-span-4">
          <Alert variant={state.ok ? "success" : "destructive"}>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="flex items-end sm:col-span-4">
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Saving…" : "Save reading"}
        </Button>
      </div>
    </form>
  );
}
