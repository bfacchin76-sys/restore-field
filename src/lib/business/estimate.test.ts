import { describe, expect, it } from "vitest";
import {
  computeEstimateTotals,
  formatUSD,
  type LineItem,
} from "./estimate";

describe("computeEstimateTotals", () => {
  /**
   * PRD §14 Phase 9 DoD:
   *   subtotal $10,000 → +20% O&P = $12,000 → +8.625% tax on $12,000
   *                    = $1,035 → total $13,035
   */
  it("DoD example: $10,000 → $13,035", () => {
    const lines: LineItem[] = [
      { description: "Mitigation labor", quantity: 1, unit: "LS", unitPrice: 10000 },
    ];
    const t = computeEstimateTotals({
      lines,
      overheadProfitRate: 0.2,
      salesTaxRate: 0.08625,
    });
    expect(t.subtotal).toBe(10000);
    expect(t.overheadProfit).toBe(2000);
    expect(t.subtotalWithOP).toBe(12000);
    expect(t.salesTax).toBe(1035);
    expect(t.total).toBe(13035);
  });

  it("sums multi-line items correctly", () => {
    const lines: LineItem[] = [
      { description: "Drywall removal", quantity: 200, unit: "SF", unitPrice: 2.5 }, // 500
      { description: "Drying labor", quantity: 16, unit: "HR", unitPrice: 75 }, // 1200
      { description: "Air mover/day", quantity: 12, unit: "EA", unitPrice: 28 }, // 336
    ];
    const t = computeEstimateTotals({
      lines,
      overheadProfitRate: 0.2,
      salesTaxRate: 0.08625,
    });
    expect(t.subtotal).toBe(2036);
    expect(t.overheadProfit).toBe(407.2);
    expect(t.subtotalWithOP).toBe(2443.2);
    // 2443.2 * 0.08625 = 210.7260 → rounds to 210.73
    expect(t.salesTax).toBe(210.73);
    expect(t.total).toBe(2653.93);
  });

  it("returns zero across the board for an empty proposal", () => {
    const t = computeEstimateTotals({
      lines: [],
      overheadProfitRate: 0.2,
      salesTaxRate: 0.08625,
    });
    expect(t.subtotal).toBe(0);
    expect(t.total).toBe(0);
    expect(t.paymentSplit.atStart).toBe(0);
  });

  it("clamps negative quantities and prices to zero", () => {
    const t = computeEstimateTotals({
      lines: [
        { description: "Glitchy line", quantity: -5, unit: "EA", unitPrice: 100 },
      ],
      overheadProfitRate: 0.2,
      salesTaxRate: 0.08625,
    });
    expect(t.subtotal).toBe(0);
  });

  it("clamps the rates to [0, 1]", () => {
    const t = computeEstimateTotals({
      lines: [{ description: "x", quantity: 1, unit: "LS", unitPrice: 100 }],
      overheadProfitRate: 1.5,
      salesTaxRate: -0.1,
    });
    // 100 + 100 (op @ 100%) = 200; tax = 0
    expect(t.overheadProfit).toBe(100);
    expect(t.salesTax).toBe(0);
    expect(t.total).toBe(200);
  });

  it("payment split sums back to total exactly", () => {
    const t = computeEstimateTotals({
      lines: [{ description: "x", quantity: 1, unit: "LS", unitPrice: 1000.99 }],
      overheadProfitRate: 0.2,
      salesTaxRate: 0.08625,
    });
    expect(round2(t.paymentSplit.atStart + t.paymentSplit.atCompletion)).toBe(t.total);
  });

  it("respects a non-default tax region (no NY tax → just O&P)", () => {
    const t = computeEstimateTotals({
      lines: [{ description: "x", quantity: 1, unit: "LS", unitPrice: 10000 }],
      overheadProfitRate: 0.2,
      salesTaxRate: 0,
    });
    expect(t.salesTax).toBe(0);
    expect(t.total).toBe(12000);
  });
});

describe("formatUSD", () => {
  it("uses two decimals + thousands separators", () => {
    expect(formatUSD(13035)).toBe("$13,035.00");
    expect(formatUSD(0)).toBe("$0.00");
    expect(formatUSD(1234.5)).toBe("$1,234.50");
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
