"use client";

import { useTransition } from "react";
import type { FormStatus } from "@prisma/client";
import {
  markCompletedManually,
  resendForSigning,
  voidSubmission,
} from "./actions";
import { Button } from "@/components/ui/button";

interface SubmissionVm {
  id: string;
  templateName: string;
  sentToEmail: string | null;
  sentAt: string | null;
  completedAt: string | null;
  status: FormStatus;
  signers: Array<{ name: string; role: string; at: string }>;
  hasPdf: boolean;
}

const STATUS_PALETTE: Record<FormStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SENT: "bg-blue-100 text-blue-800",
  PARTIALLY_SIGNED: "bg-amber-100 text-amber-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  EXPIRED: "bg-rose-100 text-rose-800",
};

export function SubmissionRow({
  submission,
  canEdit,
}: {
  submission: SubmissionVm;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <tr className="border-b last:border-b-0">
      <td className="px-6 py-2 font-medium">{submission.templateName}</td>
      <td className="px-6 py-2 text-xs text-muted-foreground">
        {submission.sentToEmail ?? "—"}
      </td>
      <td className="px-6 py-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
            STATUS_PALETTE[submission.status]
          }`}
        >
          {submission.status.replace(/_/g, " ").toLowerCase()}
        </span>
      </td>
      <td className="px-6 py-2 text-xs">
        {submission.signers.length === 0 ? (
          "—"
        ) : (
          <ul>
            {submission.signers.map((s, i) => (
              <li key={i} className="text-xs">
                <strong>{s.name}</strong>{" "}
                <span className="text-muted-foreground">
                  ({s.role}, {new Date(s.at).toLocaleString()})
                </span>
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="px-6 py-2 text-xs text-muted-foreground">
        {submission.sentAt
          ? new Date(submission.sentAt).toLocaleString()
          : "—"}
      </td>
      <td className="px-6 py-2 text-right">
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
          {submission.hasPdf ? (
            <a
              href={`/api/forms/${submission.id}/pdf`}
              className="font-medium text-primary hover:underline"
            >
              Download PDF
            </a>
          ) : null}
          {canEdit && submission.status !== "COMPLETED" && submission.status !== "EXPIRED" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  try {
                    await resendForSigning({ submissionId: submission.id });
                  } catch (err) {
                    alert(err instanceof Error ? err.message : "Failed");
                  }
                })
              }
            >
              Resend
            </Button>
          ) : null}
          {canEdit && submission.status !== "COMPLETED" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                if (!confirm("Mark this submission as completed manually?"))
                  return;
                startTransition(async () => {
                  try {
                    await markCompletedManually({
                      submissionId: submission.id,
                    });
                  } catch (err) {
                    alert(err instanceof Error ? err.message : "Failed");
                  }
                });
              }}
            >
              Mark completed
            </Button>
          ) : null}
          {canEdit &&
          submission.status !== "COMPLETED" &&
          submission.status !== "EXPIRED" ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (!confirm("Void this submission?")) return;
                startTransition(async () => {
                  try {
                    await voidSubmission({ submissionId: submission.id });
                  } catch (err) {
                    alert(err instanceof Error ? err.message : "Failed");
                  }
                });
              }}
            >
              Void
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
