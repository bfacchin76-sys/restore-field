/**
 * Estimate-proposal totals — line items → subtotal → +O&P → +sales tax.
 *
 * PRD §8.7 Estimate Proposal:
 *   Subtotal → +O&P (default 20%) → +Sales tax (8.625% in Nassau Co. NY,
 *   applied to subtotal+O&P) → Total. Both rates are configurable per
 *   organisation so the same code works in NJ etc.
 *
 * Worked example (PRD DoD):
 *   subtotal $10,000 → +20% O&P = $12,000
 *                    → +8.625% tax on $12,000 = $1,035
 *                    → Total $13,035
 */

export interface LineItem {
  /** Free-text description (e.g. "Remove and dispose of wet drywall"). */
  description: string;
  /** Optional Xactimate-style code; PRD v1 doesn't require these. */
  code?: string | null;
  /** Quantity (sqft, lf, hours, ea). */
  quantity: number;
  /** Display unit ("SF", "LF", "EA", "HR", …). */
  unit: string;
  /** Unit price in dollars. */
  unitPrice: number;
}

export interface EstimateInputs {
  lines: readonly LineItem[];
  /** 0..1 — e.g. 0.20 for 20%. Defaults to org-level value. */
  overheadProfitRate: number;
  /** 0..1 — e.g. 0.08625. */
  salesTaxRate: number;
  /** Optional: paymentTerms shown in the proposal body. */
  paymentTerms?: string | null;
}

export interface EstimateTotals {
  subtotal: number;
  overheadProfit: number;
  subtotalWithOP: number;
  salesTax: number;
  total: number;
  /** Per-line extended totals (quantity * unitPrice), parallel to inputs.lines. */
  lineExtended: number[];
  /** First-50% / second-50% payment terms. */
  paymentSplit: {
    atStart: number;
    atCompletion: number;
  };
}

/**
 * All amounts are returned in dollars rounded to 2 decimals (not cents)
 * — keeps the printed output readable; downstream invoice systems can
 * recompute in cents if they need to.
 */
function round2(n: number): number {
  // toFixed-then-Number to dodge IEEE-754 surprises
  return Number((Math.round(n * 100) / 100).toFixed(2));
}

export function computeEstimateTotals(input: EstimateInputs): EstimateTotals {
  const op = clamp01(input.overheadProfitRate);
  const tax = clamp01(input.salesTaxRate);

  const lineExtended = input.lines.map((l) =>
    round2(Math.max(0, l.quantity) * Math.max(0, l.unitPrice)),
  );
  const subtotal = round2(lineExtended.reduce((s, n) => s + n, 0));
  const overheadProfit = round2(subtotal * op);
  const subtotalWithOP = round2(subtotal + overheadProfit);
  const salesTax = round2(subtotalWithOP * tax);
  const total = round2(subtotalWithOP + salesTax);

  const half = round2(total / 2);
  // PRD §8.7: 50/50 payment split. We round the first half up so the
  // "at start" never undercollects — the at-completion piece absorbs
  // the cent.
  const atStart = half;
  const atCompletion = round2(total - atStart);

  return {
    subtotal,
    overheadProfit,
    subtotalWithOP,
    salesTax,
    total,
    lineExtended,
    paymentSplit: { atStart, atCompletion },
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function formatUSD(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

/** Default 50/50 payment-terms blurb. PRD §8.7. */
export const DEFAULT_PAYMENT_TERMS =
  "50% due at start, 50% due at completion.";
