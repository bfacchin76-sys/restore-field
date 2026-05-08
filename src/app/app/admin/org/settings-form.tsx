"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOrgSettings } from "./actions";

interface Props {
  initial: {
    salesTaxRate: number;
    overheadProfitRate: number;
    licenseNumber: string | null;
    reportFooter: string | null;
  };
}

export function OrgSettingsForm({ initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [salesTaxRate, setSalesTaxRate] = useState(initial.salesTaxRate);
  const [overheadProfitRate, setOverheadProfitRate] = useState(
    initial.overheadProfitRate,
  );
  const [licenseNumber, setLicenseNumber] = useState(initial.licenseNumber ?? "");
  const [reportFooter, setReportFooter] = useState(initial.reportFooter ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    startTransition(async () => {
      const res = await updateOrgSettings({
        salesTaxRate,
        overheadProfitRate,
        licenseNumber: licenseNumber || null,
        reportFooter: reportFooter || null,
      });
      if (!res.ok) {
        setErr(res.message ?? "Save failed.");
        return;
      }
      setMsg("Saved.");
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="op">Overhead &amp; profit rate</Label>
          <Input
            id="op"
            type="number"
            step="0.001"
            min="0"
            max="1"
            value={overheadProfitRate}
            onChange={(e) => setOverheadProfitRate(Number(e.target.value) || 0)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Default 0.20 (20%). Applied to estimate subtotals before tax.
          </p>
        </div>
        <div>
          <Label htmlFor="tax">Sales tax rate</Label>
          <Input
            id="tax"
            type="number"
            step="0.00001"
            min="0"
            max="1"
            value={salesTaxRate}
            onChange={(e) => setSalesTaxRate(Number(e.target.value) || 0)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Nassau County NY default is 0.08625 (8.625%).
          </p>
        </div>
      </div>
      <div>
        <Label htmlFor="lic">License number</Label>
        <Input
          id="lic"
          value={licenseNumber}
          onChange={(e) => setLicenseNumber(e.target.value)}
          placeholder="NY-LIC-12345"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Printed in the footer of every PDF report.
        </p>
      </div>
      <div>
        <Label htmlFor="footer">Report footer line</Label>
        <Input
          id="footer"
          value={reportFooter}
          onChange={(e) => setReportFooter(e.target.value)}
          placeholder="1-800-WATER-DAMAGE"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {msg && <span className="text-sm text-green-700">{msg}</span>}
        {err && <span className="text-sm text-red-700">{err}</span>}
      </div>
    </form>
  );
}
