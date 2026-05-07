"use client";

import { useActionState } from "react";
import type { EquipmentStatus, EquipmentType } from "@prisma/client";
import {
  createEquipment,
  type EquipmentActionResult,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initial: EquipmentActionResult = { ok: false };

export function CreateEquipmentForm({
  types,
  statuses,
}: {
  types: EquipmentType[];
  statuses: EquipmentStatus[];
}) {
  const [state, formAction, pending] = useActionState(createEquipment, initial);
  const err = (k: string) => state.fieldErrors?.[k];

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <Field label="Asset tag" error={err("assetTag")}>
        <Input name="assetTag" placeholder="AM-001" required />
      </Field>
      <Field label="Type" error={err("type")}>
        <select
          name="type"
          required
          defaultValue="AIR_MOVER"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Manufacturer">
        <Input name="manufacturer" placeholder="Phoenix" />
      </Field>
      <Field label="Model">
        <Input name="model" placeholder="Axial AirMax" />
      </Field>
      <Field label="Serial #">
        <Input name="serialNumber" />
      </Field>
      <Field label="Amperage">
        <Input name="amperage" type="number" step="0.1" />
      </Field>
      <Field label="CFM (air movers)">
        <Input name="cfm" type="number" step="1" />
      </Field>
      <Field label="PPD (dehus)">
        <Input name="ppd" type="number" step="1" />
      </Field>
      <Field label="Status">
        <select
          name="status"
          defaultValue="AVAILABLE"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase()}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Notes" full>
        <Input name="notes" />
      </Field>

      {state.message ? (
        <div className="sm:col-span-2 lg:col-span-4">
          <Alert variant={state.ok ? "success" : "destructive"}>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="flex items-end sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add equipment"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  full,
  children,
}: {
  label: string;
  error?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${full ? "sm:col-span-2 lg:col-span-4" : ""}`}>
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
