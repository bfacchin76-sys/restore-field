"use client";

import { useActionState } from "react";
import { updateJobOverview, type JobActionResult } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initial: JobActionResult = { ok: false };

export function OverviewForm({
  jobId,
  causeOfLoss,
  scopeNotes,
  lossDate,
  canEdit,
}: {
  jobId: string;
  causeOfLoss: string;
  scopeNotes: string;
  lossDate: string;
  canEdit: boolean;
}) {
  const action = updateJobOverview.bind(null, jobId);
  const [state, formAction, pending] = useActionState(action, initial);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="lossDate">Date of loss</Label>
        <Input
          id="lossDate"
          name="lossDate"
          type="date"
          defaultValue={lossDate}
          disabled={!canEdit}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="causeOfLoss">Cause of loss</Label>
        <Input
          id="causeOfLoss"
          name="causeOfLoss"
          defaultValue={causeOfLoss}
          disabled={!canEdit}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="scopeNotes">Scope notes</Label>
        <textarea
          id="scopeNotes"
          name="scopeNotes"
          rows={5}
          defaultValue={scopeNotes}
          disabled={!canEdit}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
      </div>
      {state.message ? (
        <Alert variant={state.ok ? "success" : "destructive"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {canEdit ? (
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save scope"}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Read-only — you don&apos;t have edit access on this job.
        </p>
      )}
    </form>
  );
}
