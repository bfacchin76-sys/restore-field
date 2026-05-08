"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteReport, emailReport, regenerateReport } from "./actions";

interface Props {
  reportId: string;
  type: string;
  generatedAt: string;
  pdfReady: boolean;
  generatedByName: string;
  canEdit: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  WATER_MITIGATION: "Water Mitigation",
  FIRE_LOSS: "Fire Loss",
  MOLD_REMEDIATION: "Mold Remediation",
  PHOTO_REPORT: "Photo Report",
  MOISTURE_LOG: "Moisture Log",
  EQUIPMENT_LOG: "Equipment Log",
  ESTIMATE_PROPOSAL: "Estimate Proposal",
  CONTENTS_INVENTORY: "Contents Inventory",
  CUSTOM: "Custom",
};

export function ReportRow({
  reportId,
  type,
  generatedAt,
  pdfReady,
  generatedByName,
  canEdit,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [emailMode, setEmailMode] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onRegenerate = () => {
    setError(null);
    startTransition(async () => {
      const r = await regenerateReport({ reportId });
      if (!r.ok) setError(r.message ?? "Regenerate failed");
      router.refresh();
    });
  };

  const onDelete = () => {
    if (!confirm("Delete this report?")) return;
    startTransition(async () => {
      await deleteReport({ reportId });
      router.refresh();
    });
  };

  const onEmail = () => {
    setError(null);
    startTransition(async () => {
      const r = await emailReport({
        reportId,
        recipientEmail: recipient,
        message: message || undefined,
        expiresInDays: 7,
      });
      if (!r.ok) {
        setError(r.message ?? "Email failed");
        return;
      }
      setShareUrl(r.shareUrl ?? null);
      router.refresh();
    });
  };

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{TYPE_LABEL[type] ?? type}</div>
          <div className="text-xs text-muted-foreground">
            {generatedByName} · {new Date(generatedAt).toLocaleString("en-US")}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {pdfReady ? (
            <a
              href={`/api/reports/${reportId}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-md border bg-background px-3 text-sm hover:bg-accent"
            >
              View PDF
            </a>
          ) : (
            <span className="inline-flex h-9 items-center rounded-md bg-yellow-50 px-3 text-sm text-yellow-700">
              Generating…
            </span>
          )}
          {canEdit && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onRegenerate}
                disabled={pending}
              >
                Regenerate
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEmailMode((m) => !m)}
                disabled={!pdfReady}
              >
                Email
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onDelete}
                disabled={pending}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {emailMode && (
        <div className="mt-3 space-y-2 rounded-md bg-muted p-3 text-sm">
          <div>
            <Label htmlFor={`recipient-${reportId}`}>Recipient email</Label>
            <Input
              id={`recipient-${reportId}`}
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="adjuster@example.com"
            />
          </div>
          <div>
            <Label htmlFor={`msg-${reportId}`}>Message (optional)</Label>
            <textarea
              id={`msg-${reportId}`}
              className="mt-1 block min-h-[60px] w-full rounded-md border bg-background px-3 py-2"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={onEmail}
              disabled={pending || !recipient}
            >
              Send link
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEmailMode(false)}
            >
              Cancel
            </Button>
          </div>
          {shareUrl && (
            <p className="text-xs text-muted-foreground">
              Share link (expires in 7 days):{" "}
              <a className="underline" href={shareUrl} target="_blank" rel="noreferrer">
                {shareUrl}
              </a>
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
