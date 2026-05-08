"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { encircleCsvSampleHeader } from "@/lib/import/encircle-csv";
import { importEncircleCsv, type ImportResult } from "./actions";

export function ImportForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  const onFile = async (f: File | null) => {
    if (!f) return;
    setCsv(await f.text());
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!csv.trim()) return;
    setResult(null);
    startTransition(async () => {
      const r = await importEncircleCsv(csv);
      setResult(r);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-muted p-3 text-sm">
        <div className="font-medium">Required columns:</div>
        <code className="text-xs break-all">{encircleCsvSampleHeader()}</code>
      </div>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="csv-file">CSV file</Label>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="csv-text">…or paste here</Label>
          <textarea
            id="csv-text"
            className="mt-1 block min-h-[160px] w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={encircleCsvSampleHeader()}
          />
        </div>
        <Button type="submit" disabled={pending || !csv.trim()}>
          {pending ? "Importing…" : "Import"}
        </Button>
      </form>

      {result && (
        <div
          className={`rounded-md border p-3 text-sm ${
            result.ok
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <div className="font-medium">
            {result.ok ? "Import complete" : `Import failed: ${result.message ?? ""}`}
          </div>
          <ul className="mt-1 list-disc pl-5 text-xs">
            <li>Rows parsed: {result.parsed}</li>
            <li>Customers created: {result.customersCreated}</li>
            <li>Customers reused: {result.customersReused}</li>
            <li>Jobs created: {result.jobsCreated}</li>
            <li>Row errors: {result.errors.length}</li>
          </ul>
          {result.errors.length > 0 && (
            <details className="mt-2 text-xs">
              <summary>Show errors</summary>
              <ul className="mt-1 list-disc pl-5">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
