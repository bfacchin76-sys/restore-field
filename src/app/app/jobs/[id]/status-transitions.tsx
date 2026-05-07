"use client";

import { useActionState } from "react";
import type { JobStatus } from "@prisma/client";
import {
  transitionJobStatus,
  type StatusActionResult,
} from "../actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { nextStatuses, transitionLabel } from "@/lib/business/job-status";

const initial: StatusActionResult = { ok: false };

export function StatusTransitions({
  jobId,
  status,
  canEdit,
}: {
  jobId: string;
  status: JobStatus;
  canEdit: boolean;
}) {
  const action = transitionJobStatus.bind(null, jobId);
  const [state, formAction, pending] = useActionState(action, initial);

  const targets = nextStatuses(status);
  const variantFor = (to: JobStatus) =>
    to === "CANCELLED" ? "destructive" : "default";

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Current status:{" "}
        <strong className="uppercase">
          {status.replace("_", " ").toLowerCase()}
        </strong>
      </p>

      {targets.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          This job is in a terminal state — no further transitions allowed.
        </p>
      ) : !canEdit ? (
        <p className="text-xs text-muted-foreground">
          You don&apos;t have permission to change status on this job.
        </p>
      ) : (
        <form action={formAction} className="flex flex-wrap gap-2">
          {targets.map((to) => (
            <Button
              key={to}
              type="submit"
              name="to"
              value={to}
              variant={variantFor(to)}
              size="sm"
              disabled={pending}
            >
              {transitionLabel(status, to)}
            </Button>
          ))}
        </form>
      )}

      {state.message ? (
        <Alert variant={state.ok ? "success" : "destructive"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
