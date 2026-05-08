"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createJobShare } from "./actions";

interface ReportOption {
  id: string;
  type: string;
  generatedAt: string;
  pdfReady: boolean;
}

interface Props {
  jobId: string;
  reports: ReportOption[];
}

export function ShareForm({ jobId, reports }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [days, setDays] = useState(7);
  const [photos, setPhotos] = useState(true);
  const [readings, setReadings] = useState(true);
  const [dryingLogs, setDryingLogs] = useState(true);
  const [equipment, setEquipment] = useState(false);
  const [selectedReports, setSelectedReports] = useState<Set<string>>(
    new Set(),
  );
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setShareUrl(null);
    startTransition(async () => {
      const r = await createJobShare({
        jobId,
        recipientEmail: recipient,
        message: message || undefined,
        expiresInDays: days,
        scopes: {
          photos,
          readings,
          dryingLogs,
          equipment,
          reportIds: Array.from(selectedReports),
        },
      });
      if (!r.ok) {
        setErr(r.message ?? "Share failed");
        return;
      }
      setShareUrl(r.shareUrl ?? null);
      router.refresh();
    });
  };

  const toggleReport = (id: string) => {
    const next = new Set(selectedReports);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedReports(next);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="email">Recipient email</Label>
          <Input
            id="email"
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="adjuster@example.com"
            required
          />
        </div>
        <div>
          <Label htmlFor="days">Expires in (days)</Label>
          <Input
            id="days"
            type="number"
            min="1"
            max="60"
            value={days}
            onChange={(e) => setDays(Number(e.target.value) || 7)}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="msg">Message (optional)</Label>
        <textarea
          id="msg"
          className="mt-1 block min-h-[60px] w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Hi, here's the documentation for the loss at 12 Maple Ave."
        />
      </div>

      <fieldset className="rounded-md border p-3">
        <legend className="text-sm font-medium">What to share</legend>
        <div className="mt-2 grid grid-cols-2 gap-1 text-sm">
          <Checkbox label="Photos" checked={photos} onChange={setPhotos} />
          <Checkbox
            label="Moisture readings"
            checked={readings}
            onChange={setReadings}
          />
          <Checkbox
            label="Drying log"
            checked={dryingLogs}
            onChange={setDryingLogs}
          />
          <Checkbox
            label="Equipment placements"
            checked={equipment}
            onChange={setEquipment}
          />
        </div>
        {reports.length > 0 && (
          <div className="mt-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">
              Reports
            </div>
            <div className="mt-1 space-y-1 text-sm">
              {reports.map((r) => (
                <label key={r.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!r.pdfReady}
                    checked={selectedReports.has(r.id)}
                    onChange={() => toggleReport(r.id)}
                  />
                  <span>
                    {r.type} ·{" "}
                    {new Date(r.generatedAt).toLocaleDateString("en-US")}
                    {!r.pdfReady && " (still generating)"}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !recipient}>
          {pending ? "Sending…" : "Create share & email"}
        </Button>
      </div>

      {err && (
        <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {err}
        </p>
      )}
      {shareUrl && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Share created. Link:{" "}
          <a
            href={shareUrl}
            target="_blank"
            rel="noreferrer"
            className="break-all underline"
          >
            {shareUrl}
          </a>
        </div>
      )}
    </form>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
