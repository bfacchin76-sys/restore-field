"use client";

import { useState, useTransition } from "react";
import { sendFormForSigning } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function SendFormForm({
  jobId,
  templates,
  defaultEmail,
}: {
  jobId: string;
  templates: Array<{ id: string; name: string }>;
  defaultEmail: string;
}) {
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? "");
  const [email, setEmail] = useState<string>(defaultEmail);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { ok: true; message: string }
    | { ok: false; message: string }
    | null
  >(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        if (!templateId || !email.trim()) return;
        startTransition(async () => {
          const r = await sendFormForSigning({
            jobId,
            templateId,
            recipientEmail: email.trim(),
          });
          setResult(
            r.ok
              ? { ok: true, message: "Form sent. Recipient should see the email shortly." }
              : { ok: false, message: r.message ?? "Failed" },
          );
        });
      }}
      className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]"
    >
      <div className="space-y-1.5">
        <Label htmlFor="sf-template">Template</Label>
        <select
          id="sf-template"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          required
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sf-email">Recipient email</Label>
        <Input
          id="sf-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending || !templateId || !email.trim()}>
          {pending ? "Sending…" : "Send for signing"}
        </Button>
      </div>

      {result ? (
        <div className="sm:col-span-3">
          <Alert variant={result.ok ? "success" : "destructive"}>
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
        </div>
      ) : null}
    </form>
  );
}
