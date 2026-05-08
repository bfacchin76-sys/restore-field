"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ReportType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  computeEstimateTotals,
  formatUSD,
  type LineItem,
} from "@/lib/business/estimate";
import { generateReport } from "./actions";

interface Props {
  jobId: string;
  defaultOverheadProfitRate: number;
  defaultSalesTaxRate: number;
}

const REPORT_OPTIONS: Array<{ value: ReportType; label: string; hint: string }> = [
  { value: "WATER_MITIGATION", label: "Water Mitigation", hint: "Photos, readings, drying logs, equipment" },
  { value: "FIRE_LOSS", label: "Fire Loss", hint: "Photos + scope" },
  { value: "MOLD_REMEDIATION", label: "Mold Remediation", hint: "Photos + readings + scope" },
  { value: "MOISTURE_LOG", label: "Moisture Log", hint: "Readings + drying logs" },
  { value: "EQUIPMENT_LOG", label: "Equipment Log", hint: "Placements + daily totals" },
  { value: "PHOTO_REPORT", label: "Photo Report", hint: "Photo log only" },
  { value: "ESTIMATE_PROPOSAL", label: "Estimate Proposal", hint: "Line items + O&P + tax" },
  { value: "CONTENTS_INVENTORY", label: "Contents Inventory", hint: "Rooms + photos" },
  { value: "CUSTOM", label: "Custom (everything)", hint: "Kitchen sink" },
];

const blankLine = (): LineItem => ({
  description: "",
  code: null,
  quantity: 1,
  unit: "EA",
  unitPrice: 0,
});

export function GenerateReportForm({
  jobId,
  defaultOverheadProfitRate,
  defaultSalesTaxRate,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reportType, setReportType] = useState<ReportType>("WATER_MITIGATION");
  const [scopeSummary, setScopeSummary] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Estimate-only state
  const [overheadProfitRate, setOverheadProfitRate] = useState(
    defaultOverheadProfitRate,
  );
  const [salesTaxRate, setSalesTaxRate] = useState(defaultSalesTaxRate);
  const [lines, setLines] = useState<LineItem[]>([blankLine()]);

  const totals =
    reportType === "ESTIMATE_PROPOSAL"
      ? computeEstimateTotals({ lines, overheadProfitRate, salesTaxRate })
      : null;

  const onSubmit = () => {
    setError(null);
    startTransition(async () => {
      const config: Parameters<typeof generateReport>[0]["config"] = {
        scopeSummary: scopeSummary || undefined,
      };
      if (reportType === "ESTIMATE_PROPOSAL") {
        const goodLines = lines.filter(
          (l) => l.description.trim().length > 0 && l.quantity > 0,
        );
        if (goodLines.length === 0) {
          setError("Add at least one line item with description and quantity > 0.");
          return;
        }
        config.estimate = {
          overheadProfitRate,
          salesTaxRate,
          lines: goodLines,
        };
      }

      const res = await generateReport({
        jobId,
        reportType,
        config,
      });
      if (!res.ok) {
        setError(res.message ?? "Generation failed.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Generate report</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="report-type">Report type</Label>
            <select
              id="report-type"
              className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
            >
              {REPORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {REPORT_OPTIONS.find((o) => o.value === reportType)?.hint}
            </p>
          </div>
        </div>

        <div>
          <Label htmlFor="scope">Scope summary (optional)</Label>
          <textarea
            id="scope"
            className="mt-1 block min-h-[60px] w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={scopeSummary}
            onChange={(e) => setScopeSummary(e.target.value)}
            placeholder="One or two sentences shown on the cover page."
          />
        </div>

        {reportType === "ESTIMATE_PROPOSAL" && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="op">O&amp;P rate</Label>
                <Input
                  id="op"
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={overheadProfitRate}
                  onChange={(e) =>
                    setOverheadProfitRate(Number(e.target.value) || 0)
                  }
                  className="w-28"
                />
              </div>
              <div>
                <Label htmlFor="tax">Sales tax</Label>
                <Input
                  id="tax"
                  type="number"
                  step="0.00001"
                  min="0"
                  max="1"
                  value={salesTaxRate}
                  onChange={(e) =>
                    setSalesTaxRate(Number(e.target.value) || 0)
                  }
                  className="w-28"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="px-2 py-1">Description</th>
                    <th className="px-2 py-1">Qty</th>
                    <th className="px-2 py-1">Unit</th>
                    <th className="px-2 py-1">Unit price</th>
                    <th className="px-2 py-1">Extended</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1">
                        <Input
                          value={l.description}
                          onChange={(e) => {
                            const next = [...lines];
                            next[i] = { ...l, description: e.target.value };
                            setLines(next);
                          }}
                          placeholder="e.g. Remove and dispose wet drywall"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={l.quantity}
                          onChange={(e) => {
                            const next = [...lines];
                            next[i] = { ...l, quantity: Number(e.target.value) || 0 };
                            setLines(next);
                          }}
                          className="w-24"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          value={l.unit}
                          onChange={(e) => {
                            const next = [...lines];
                            next[i] = { ...l, unit: e.target.value };
                            setLines(next);
                          }}
                          className="w-20"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={l.unitPrice}
                          onChange={(e) => {
                            const next = [...lines];
                            next[i] = { ...l, unitPrice: Number(e.target.value) || 0 };
                            setLines(next);
                          }}
                          className="w-28"
                        />
                      </td>
                      <td className="px-2 py-1 text-right">
                        {totals ? formatUSD(totals.lineExtended[i] ?? 0) : "$0.00"}
                      </td>
                      <td className="px-2 py-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={lines.length === 1}
                          onClick={() =>
                            setLines(lines.filter((_, j) => j !== i))
                          }
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines([...lines, blankLine()])}
            >
              Add line
            </Button>

            {totals && (
              <div className="mt-3 grid grid-cols-2 gap-y-1 text-sm sm:max-w-sm">
                <div className="text-muted-foreground">Subtotal</div>
                <div className="text-right">{formatUSD(totals.subtotal)}</div>
                <div className="text-muted-foreground">
                  O&amp;P ({(overheadProfitRate * 100).toFixed(2)}%)
                </div>
                <div className="text-right">{formatUSD(totals.overheadProfit)}</div>
                <div className="text-muted-foreground">Subtotal w/ O&amp;P</div>
                <div className="text-right">{formatUSD(totals.subtotalWithOP)}</div>
                <div className="text-muted-foreground">
                  Sales tax ({(salesTaxRate * 100).toFixed(3)}%)
                </div>
                <div className="text-right">{formatUSD(totals.salesTax)}</div>
                <div className="border-t pt-1 font-semibold">Total</div>
                <div className="border-t pt-1 text-right font-semibold">
                  {formatUSD(totals.total)}
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <Button onClick={onSubmit} disabled={pending}>
          {pending ? "Queuing…" : "Generate PDF"}
        </Button>
      </CardContent>
    </Card>
  );
}
