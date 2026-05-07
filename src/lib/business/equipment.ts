/**
 * Equipment business logic — daily-count math + CSV import schema.
 *
 *   - dailyEquipmentCounts(): given a list of EquipmentPlacement rows
 *     (placedAt/removedAt) and a date range, returns an array of
 *     { day, byType } records — used for the Gantt-ish timeline and
 *     for the billing-day summary in invoice exports.
 *   - parseEquipmentCsv() / equipmentCsvHeader: strict, friendly
 *     CSV parser used by the bulk-import flow on /app/equipment.
 *
 * No DB / `server-only` import — these are pure helpers and easy to test.
 */

import { EquipmentType, EquipmentStatus } from "@prisma/client";

export interface PlacementForCount {
  equipmentId: string;
  type: EquipmentType;
  placedAt: Date;
  removedAt: Date | null;
}

export interface DailyCountRow {
  /** Calendar day in UTC (midnight). */
  day: Date;
  /** Total equipment items deployed at any point during this day. */
  total: number;
  /** Counts by EquipmentType. */
  byType: Partial<Record<EquipmentType, number>>;
}

function dayStart(d: Date): Date {
  const o = new Date(d);
  o.setUTCHours(0, 0, 0, 0);
  return o;
}

function nextDay(d: Date): Date {
  return new Date(d.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * For each calendar day in [from, to], count distinct equipment items
 * whose [placedAt, removedAt) interval overlaps that day. An item that's
 * placed at 14:00 and removed at 13:59 the next day counts on both days.
 *
 * The set is "distinct equipmentId" so the same unit moved between rooms
 * within a job doesn't double-count.
 */
export function dailyEquipmentCounts(
  placements: readonly PlacementForCount[],
  from: Date,
  to: Date,
): DailyCountRow[] {
  const start = dayStart(from);
  const end = dayStart(to);
  const out: DailyCountRow[] = [];

  for (let day = start; day <= end; day = nextDay(day)) {
    const dayEnd = nextDay(day);
    const seen = new Set<string>();
    const byType: Partial<Record<EquipmentType, number>> = {};
    for (const p of placements) {
      const stop = p.removedAt ?? new Date(8.64e15); // far future
      // overlap: placedAt < dayEnd && (removedAt is null || removedAt > day)
      if (p.placedAt < dayEnd && stop > day) {
        if (seen.has(p.equipmentId)) continue;
        seen.add(p.equipmentId);
        byType[p.type] = (byType[p.type] ?? 0) + 1;
      }
    }
    out.push({
      day: new Date(day),
      total: seen.size,
      byType,
    });
  }
  return out;
}

// =======================================================
// CSV import for the equipment master list
// =======================================================

export const equipmentCsvHeader = [
  "assetTag",
  "type",
  "manufacturer",
  "model",
  "serialNumber",
  "amperage",
  "cfm",
  "ppd",
  "status",
  "notes",
] as const;
export type EquipmentCsvCol = (typeof equipmentCsvHeader)[number];

export interface ParsedEquipmentRow {
  assetTag: string;
  type: EquipmentType;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  amperage: number | null;
  cfm: number | null;
  ppd: number | null;
  status: EquipmentStatus;
  notes: string | null;
}

export interface ParseEquipmentCsvResult {
  rows: ParsedEquipmentRow[];
  errors: Array<{ line: number; message: string }>;
}

/**
 * RFC-4180-ish CSV split for a single line — handles quoted fields with
 * doubled quotes. Doesn't handle embedded newlines.
 */
function splitCsvLine(line: string): string[] {
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

const TYPE_VALUES = Object.values(EquipmentType) as readonly string[];
const STATUS_VALUES = Object.values(EquipmentStatus) as readonly string[];

function nullishStr(v: string | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function nullishInt(v: string | undefined): number | null {
  const t = nullishStr(v);
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function nullishFloat(v: string | undefined): number | null {
  const t = nullishStr(v);
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a CSV blob with the columns listed in `equipmentCsvHeader`.
 * The header row is required and validated — any unknown columns are
 * ignored, any required columns missing produce an error.
 */
export function parseEquipmentCsv(csv: string): ParseEquipmentCsvResult {
  const rows: ParsedEquipmentRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { rows, errors: [{ line: 0, message: "CSV is empty" }] };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const idx = (col: EquipmentCsvCol) => header.indexOf(col);

  for (const required of ["assetTag", "type"] as const) {
    if (idx(required) === -1) {
      errors.push({ line: 1, message: `Missing required column: ${required}` });
    }
  }
  if (errors.length) return { rows, errors };

  const seenTags = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const get = (col: EquipmentCsvCol) =>
      idx(col) === -1 ? undefined : cells[idx(col)];

    const assetTag = nullishStr(get("assetTag"));
    if (!assetTag) {
      errors.push({ line: i + 1, message: "Missing assetTag" });
      continue;
    }
    if (seenTags.has(assetTag)) {
      errors.push({
        line: i + 1,
        message: `Duplicate assetTag in CSV: ${assetTag}`,
      });
      continue;
    }
    seenTags.add(assetTag);

    const typeRaw = (nullishStr(get("type")) ?? "").toUpperCase();
    if (!TYPE_VALUES.includes(typeRaw)) {
      errors.push({
        line: i + 1,
        message: `Unknown type "${typeRaw}". Allowed: ${TYPE_VALUES.join(", ")}`,
      });
      continue;
    }
    const statusRaw = (nullishStr(get("status")) ?? "AVAILABLE").toUpperCase();
    if (!STATUS_VALUES.includes(statusRaw)) {
      errors.push({
        line: i + 1,
        message: `Unknown status "${statusRaw}". Allowed: ${STATUS_VALUES.join(", ")}`,
      });
      continue;
    }

    rows.push({
      assetTag,
      type: typeRaw as EquipmentType,
      manufacturer: nullishStr(get("manufacturer")),
      model: nullishStr(get("model")),
      serialNumber: nullishStr(get("serialNumber")),
      amperage: nullishFloat(get("amperage")),
      cfm: nullishInt(get("cfm")),
      ppd: nullishInt(get("ppd")),
      status: statusRaw as EquipmentStatus,
      notes: nullishStr(get("notes")),
    });
  }

  return { rows, errors };
}

export function equipmentCsvSampleHeader(): string {
  return equipmentCsvHeader.join(",");
}
