"use client";

import { useActionState, useState } from "react";
import { upsertDryingLog, type DryingActionResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { gppRounded } from "@/lib/business/psychrometrics";

const initial: DryingActionResult = { ok: false };

interface InitialLog {
  outsideTempF: number | null;
  outsideRH: number | null;
  outsideGPP: number | null;
  unaffectedTempF: number | null;
  unaffectedRH: number | null;
  unaffectedGPP: number | null;
  affectedTempF: number | null;
  affectedRH: number | null;
  affectedGPP: number | null;
  hvacTempF: number | null;
  hvacRH: number | null;
  hvacGPP: number | null;
  techNotes: string | null;
}

const QUADRANTS = [
  { id: "outside", label: "Outside" },
  { id: "unaffected", label: "Unaffected" },
  { id: "affected", label: "Affected" },
  { id: "hvac", label: "HVAC supply" },
] as const;

type QuadrantId = (typeof QUADRANTS)[number]["id"];

interface QuadrantState {
  tempF: string;
  rh: string;
  gpp: string;
}

function num(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  return String(v);
}

export function DryingLogForm({
  jobId,
  logDate,
  initial: initialLog,
}: {
  jobId: string;
  logDate: string;
  initial: InitialLog | null;
}) {
  const [state, formAction, pending] = useActionState(
    upsertDryingLog,
    initial,
  );

  const [quad, setQuad] = useState<Record<QuadrantId, QuadrantState>>({
    outside: {
      tempF: num(initialLog?.outsideTempF),
      rh: num(initialLog?.outsideRH),
      gpp: num(initialLog?.outsideGPP),
    },
    unaffected: {
      tempF: num(initialLog?.unaffectedTempF),
      rh: num(initialLog?.unaffectedRH),
      gpp: num(initialLog?.unaffectedGPP),
    },
    affected: {
      tempF: num(initialLog?.affectedTempF),
      rh: num(initialLog?.affectedRH),
      gpp: num(initialLog?.affectedGPP),
    },
    hvac: {
      tempF: num(initialLog?.hvacTempF),
      rh: num(initialLog?.hvacRH),
      gpp: num(initialLog?.hvacGPP),
    },
  });

  const setQuadField = (
    id: QuadrantId,
    field: keyof QuadrantState,
    value: string,
  ) => {
    setQuad((prev) => {
      const next = { ...prev[id], [field]: value };
      // Live-recompute GPP whenever temp & RH are both filled and GPP is empty
      // or was previously auto-filled (we treat any blank GPP as auto-fillable).
      if (field !== "gpp") {
        const t = Number(next.tempF);
        const r = Number(next.rh);
        if (Number.isFinite(t) && Number.isFinite(r) && next.tempF && next.rh) {
          // Only auto-fill when GPP is empty — don't clobber a manual entry.
          if (!prev[id].gpp || prev[id].gpp === computeGppPreviewFor(prev[id])) {
            next.gpp = String(gppRounded(t, r));
          }
        }
      }
      return { ...prev, [id]: next };
    });
  };

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="logDate" value={logDate} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {QUADRANTS.map((q) => (
          <fieldset
            key={q.id}
            className="space-y-2 rounded-md border border-border bg-muted/20 p-3"
          >
            <legend className="px-1 text-xs font-semibold uppercase text-muted-foreground">
              {q.label}
            </legend>
            <Field label="Temp °F">
              <Input
                name={`${q.id}TempF`}
                type="number"
                step="0.1"
                inputMode="decimal"
                value={quad[q.id].tempF}
                onChange={(e) => setQuadField(q.id, "tempF", e.target.value)}
              />
            </Field>
            <Field label="RH %">
              <Input
                name={`${q.id}RH`}
                type="number"
                step="0.1"
                min="0"
                max="100"
                inputMode="decimal"
                value={quad[q.id].rh}
                onChange={(e) => setQuadField(q.id, "rh", e.target.value)}
              />
            </Field>
            <Field
              label={
                <>
                  GPP{" "}
                  {!quad[q.id].gpp && quad[q.id].tempF && quad[q.id].rh ? (
                    <span className="text-[10px] font-normal text-muted-foreground">
                      (auto)
                    </span>
                  ) : null}
                </>
              }
            >
              <Input
                name={`${q.id}GPP`}
                type="number"
                step="0.1"
                inputMode="decimal"
                value={quad[q.id].gpp}
                onChange={(e) => setQuadField(q.id, "gpp", e.target.value)}
                placeholder={
                  quad[q.id].tempF && quad[q.id].rh
                    ? String(
                        gppRounded(
                          Number(quad[q.id].tempF),
                          Number(quad[q.id].rh),
                        ),
                      )
                    : "—"
                }
              />
            </Field>
          </fieldset>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="dl-notes">Tech notes</Label>
        <textarea
          id="dl-notes"
          name="techNotes"
          rows={3}
          defaultValue={initialLog?.techNotes ?? ""}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Containment changed, equipment moved, ambient observations…"
        />
      </div>

      {state.message ? (
        <Alert variant={state.ok ? "success" : "destructive"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save log"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      {children}
    </div>
  );
}

function computeGppPreviewFor(q: QuadrantState): string {
  const t = Number(q.tempF);
  const r = Number(q.rh);
  if (!q.tempF || !q.rh || !Number.isFinite(t) || !Number.isFinite(r)) return "";
  return String(gppRounded(t, r));
}
