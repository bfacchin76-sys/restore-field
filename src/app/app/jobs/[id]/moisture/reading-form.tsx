"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import type { Material, MeterType, ScaleType } from "@prisma/client";
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
  const [offlineState, setOfflineState] = useState<ReadingActionResult>(initial);
  const [offlinePending, startOfflineTransition] = useTransition();
  const valueRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const datalistId = useId();

  // After a successful submit, refocus the value input so the next reading
  // can be punched in immediately. PRD §14 DoD: <10s per reading.
  useEffect(() => {
    if (state.ok || offlineState.ok) valueRef.current?.focus();
  }, [state.ok, offlineState.ok]);

  // Reset the form on successful offline-queue (the server action does
  // this automatically on success; mirror it for parity).
  useEffect(() => {
    if (offlineState.ok) {
      formRef.current?.reset();
    }
  }, [offlineState.ok]);

  const handleOfflineSubmit = async (fd: FormData) => {
    const moistureValue = Number(fd.get("moistureValue"));
    if (!Number.isFinite(moistureValue)) {
      setOfflineState({ ok: false, message: "Enter a numeric reading." });
      return;
    }
    const surface = String(fd.get("surface") ?? "").trim();
    if (!surface) {
      setOfflineState({ ok: false, message: "Surface is required." });
      return;
    }
    try {
      const { enqueueReading } = await import("@/lib/offline/sync");
      await enqueueReading({
        jobId,
        roomId: (String(fd.get("roomId") ?? "") || null) as string | null,
        surface,
        material: String(fd.get("material") ?? "DRYWALL") as Material,
        meterType: String(fd.get("meterType") ?? "PIN") as MeterType,
        scaleType: "PERCENT_MC" as ScaleType,
        moistureValue,
        ambientTempF: null,
        ambientRH: null,
        isDryGoal: fd.get("isDryGoal") === "true",
        isInitial: fd.get("isInitial") === "true",
        notes: (String(fd.get("notes") ?? "").trim() || null) as string | null,
      });
      setOfflineState({
        ok: true,
        message: "Saved offline — will sync when you're back online.",
        surface,
      });
    } catch (err) {
      setOfflineState({
        ok: false,
        message: err instanceof Error ? err.message : "Queue failed",
      });
    }
  };

  const submitState = offlineState.message ? offlineState : state;
  const isPending = pending || offlinePending;

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(e) => {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startOfflineTransition(async () => {
            await handleOfflineSubmit(fd);
          });
        }
      }}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
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

      {submitState.message ? (
        <div className="sm:col-span-4">
          <Alert variant={submitState.ok ? "success" : "destructive"}>
            <AlertDescription>{submitState.message}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="flex items-end sm:col-span-4">
        <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
          {isPending ? "Saving…" : "Save reading"}
        </Button>
      </div>
    </form>
  );
}
