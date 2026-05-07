"use client";

import { useActionState } from "react";
import type { LossType } from "@prisma/client";
import { createJob, type JobActionResult } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface NewJobFormProps {
  customers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    addressLine1: string;
    city: string;
  }>;
  initialCustomerId?: string;
  lossTypes: LossType[];
}

const initial: JobActionResult = { ok: false };

export function NewJobForm({
  customers,
  initialCustomerId,
  lossTypes,
}: NewJobFormProps) {
  const [state, formAction, pending] = useActionState(createJob, initial);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="customerId">Customer</Label>
        <select
          id="customerId"
          name="customerId"
          defaultValue={initialCustomerId ?? ""}
          required
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="" disabled>
            Pick a customer…
          </option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.lastName}, {c.firstName} — {c.addressLine1}, {c.city}
            </option>
          ))}
        </select>
        {state.fieldErrors?.customerId ? (
          <p className="text-xs font-medium text-destructive">
            {state.fieldErrors.customerId}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="lossType">Loss type</Label>
          <select
            id="lossType"
            name="lossType"
            required
            defaultValue=""
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="" disabled>
              Pick a loss type…
            </option>
            {lossTypes.map((lt) => (
              <option key={lt} value={lt}>
                {lt.toLowerCase()}
              </option>
            ))}
          </select>
          {state.fieldErrors?.lossType ? (
            <p className="text-xs font-medium text-destructive">
              {state.fieldErrors.lossType}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lossDate">Date of loss</Label>
          <Input id="lossDate" name="lossDate" type="date" />
          {state.fieldErrors?.lossDate ? (
            <p className="text-xs font-medium text-destructive">
              {state.fieldErrors.lossDate}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="causeOfLoss">Cause of loss (brief)</Label>
        <Input
          id="causeOfLoss"
          name="causeOfLoss"
          placeholder="e.g. supply line burst under kitchen sink"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="scopeNotes">Scope notes</Label>
        <textarea
          id="scopeNotes"
          name="scopeNotes"
          rows={4}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Affected rooms, materials, special considerations…"
        />
      </div>

      {state.message ? (
        <Alert variant={state.ok ? "success" : "destructive"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create job"}
        </Button>
      </div>
    </form>
  );
}
