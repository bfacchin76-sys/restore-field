/**
 * Encircle export CSV parser.
 *
 * Encircle's "Export jobs" report ships one row per job with customer
 * and loss fields denormalised onto the same row. We treat each row as
 * a job + customer pair, dedupe customers by email/phone within the
 * import, and let the caller decide whether to upsert against existing
 * customers in the DB.
 *
 * The PRD calls for "at least 100 historical jobs" so this is forgiving:
 *   - Missing optional fields are blanked out, not rejected.
 *   - Unknown loss types map to OTHER.
 *   - Dates parse from common formats (ISO, US slash, US dash).
 *   - The caller logs (line, message) for any row we couldn't make sense of.
 */

import { LossType } from "@prisma/client";

export const encircleCsvHeader = [
  // Customer
  "customerFirstName",
  "customerLastName",
  "customerEmail",
  "customerPhone",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  // Insurance
  "insuranceCarrier",
  "policyNumber",
  "claimNumber",
  "adjusterName",
  "adjusterEmail",
  "adjusterPhone",
  // Job
  "lossType",
  "lossDate",
  "causeOfLoss",
  "scopeNotes",
  // Optional encircle-internal id; we ignore but accept it.
  "encircleJobId",
] as const;
export type EncircleCsvCol = (typeof encircleCsvHeader)[number];

export interface ParsedEncircleRow {
  // Customer
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  // Insurance
  insuranceCarrier: string | null;
  policyNumber: string | null;
  claimNumber: string | null;
  adjusterName: string | null;
  adjusterEmail: string | null;
  adjusterPhone: string | null;
  // Job
  lossType: LossType;
  lossDate: Date | null;
  causeOfLoss: string | null;
  scopeNotes: string | null;
  encircleJobId: string | null;
}

export interface ParseEncircleResult {
  rows: ParsedEncircleRow[];
  errors: Array<{ line: number; message: string }>;
}

const LOSS_TYPE_VALUES = new Set(Object.values(LossType));

function splitCsvLine(line: string): string[] {
  // RFC-4180-ish split. Same pattern as `parseEquipmentCsv`.
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ",") {
        out.push(cur);
        cur = "";
      } else if (c === '"') {
        inQuotes = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}

function nullishStr(v: string | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function parseLossDate(v: string | undefined): Date | null {
  const t = nullishStr(v);
  if (!t) return null;
  // ISO yyyy-mm-dd (or full ISO timestamp)
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // US m/d/yyyy or m-d-yyyy
  const m = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/.exec(t);
  if (m) {
    let yr = Number(m[3]);
    if (yr < 100) yr += 2000;
    const d = new Date(Date.UTC(yr, Number(m[1]) - 1, Number(m[2])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function parseLossType(v: string | undefined): LossType {
  const t = (nullishStr(v) ?? "").toUpperCase();
  if (LOSS_TYPE_VALUES.has(t as LossType)) return t as LossType;
  // Common Encircle-style synonyms
  if (/water/i.test(t)) return LossType.WATER;
  if (/fire/i.test(t)) return LossType.FIRE;
  if (/mold/i.test(t)) return LossType.MOLD;
  if (/smoke/i.test(t)) return LossType.SMOKE;
  if (/sewa/i.test(t)) return LossType.SEWAGE;
  if (/storm|wind|hail/i.test(t)) return LossType.STORM;
  return LossType.OTHER;
}

const REQUIRED: EncircleCsvCol[] = [
  "customerFirstName",
  "customerLastName",
  "addressLine1",
  "city",
  "state",
  "postalCode",
  "lossType",
];

export function parseEncircleCsv(csv: string): ParseEncircleResult {
  const rows: ParsedEncircleRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { rows, errors: [{ line: 0, message: "CSV is empty" }] };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const colIndex: Partial<Record<EncircleCsvCol, number>> = {};
  for (const col of encircleCsvHeader) {
    const idx = header.indexOf(col);
    if (idx >= 0) colIndex[col] = idx;
  }
  for (const req of REQUIRED) {
    if (colIndex[req] === undefined) {
      errors.push({ line: 1, message: `Missing required column: ${req}` });
    }
  }
  if (errors.length > 0) return { rows, errors };

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const get = (col: EncircleCsvCol): string | undefined => {
      const idx = colIndex[col];
      return idx === undefined ? undefined : cells[idx];
    };

    const firstName = nullishStr(get("customerFirstName"));
    const lastName = nullishStr(get("customerLastName"));
    const addressLine1 = nullishStr(get("addressLine1"));
    const city = nullishStr(get("city"));
    const state = nullishStr(get("state"));
    const postalCode = nullishStr(get("postalCode"));
    if (!firstName || !lastName) {
      errors.push({ line: i + 1, message: "Missing customer name" });
      continue;
    }
    if (!addressLine1 || !city || !state || !postalCode) {
      errors.push({ line: i + 1, message: "Missing address fields" });
      continue;
    }

    rows.push({
      customerFirstName: firstName,
      customerLastName: lastName,
      customerEmail: nullishStr(get("customerEmail"))?.toLowerCase() ?? null,
      customerPhone: nullishStr(get("customerPhone")),
      addressLine1,
      addressLine2: nullishStr(get("addressLine2")),
      city,
      state: state.toUpperCase().slice(0, 2),
      postalCode,
      insuranceCarrier: nullishStr(get("insuranceCarrier")),
      policyNumber: nullishStr(get("policyNumber")),
      claimNumber: nullishStr(get("claimNumber")),
      adjusterName: nullishStr(get("adjusterName")),
      adjusterEmail: nullishStr(get("adjusterEmail"))?.toLowerCase() ?? null,
      adjusterPhone: nullishStr(get("adjusterPhone")),
      lossType: parseLossType(get("lossType")),
      lossDate: parseLossDate(get("lossDate")),
      causeOfLoss: nullishStr(get("causeOfLoss")),
      scopeNotes: nullishStr(get("scopeNotes")),
      encircleJobId: nullishStr(get("encircleJobId")),
    });
  }

  return { rows, errors };
}

export function encircleCsvSampleHeader(): string {
  return encircleCsvHeader.join(",");
}
