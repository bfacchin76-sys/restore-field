/**
 * Snapshot shape guard. Audit M3: the report-generate worker used to
 * blind-cast `Report.dataSnapshot` to `ReportSnapshot`, so a schema
 * drift (or a row written by an older code path) would explode inside
 * Handlebars with an opaque `undefined.map()`. This guard runs first
 * and returns a structured `{ ok, reason }` so the worker can persist
 * `processingError` for operators.
 *
 * The check is intentionally shallow — we don't try to validate every
 * field. Just enough to ensure the renderer's required spine
 * (org, job, customer, the array fields it iterates) is intact.
 */

export type ShapeCheck =
  | { ok: true }
  | { ok: false; reason: string };

const STRING_FIELDS_ORG = ["id", "name", "primaryColor"] as const;
const STRING_FIELDS_JOB = ["id", "jobNumber", "lossType", "status"] as const;
const STRING_FIELDS_CUSTOMER = [
  "firstName",
  "lastName",
  "addressLine1",
  "city",
  "state",
  "postalCode",
] as const;
const ARRAY_FIELDS = [
  "rooms",
  "photos",
  "readings",
  "dryingLogs",
  "placements",
  "forms",
  "dailyEquipmentCounts",
] as const;

export function isValidReportSnapshot(input: unknown): ShapeCheck {
  if (!input || typeof input !== "object") {
    return { ok: false, reason: "snapshot is not an object" };
  }
  const s = input as Record<string, unknown>;

  if (typeof s.generatedAt !== "string") {
    return { ok: false, reason: "missing generatedAt" };
  }
  if (typeof s.reportType !== "string") {
    return { ok: false, reason: "missing reportType" };
  }

  const org = s.org;
  if (!org || typeof org !== "object") {
    return { ok: false, reason: "missing org block" };
  }
  for (const k of STRING_FIELDS_ORG) {
    if (typeof (org as Record<string, unknown>)[k] !== "string") {
      return { ok: false, reason: `org.${k} is not a string` };
    }
  }

  const job = s.job;
  if (!job || typeof job !== "object") {
    return { ok: false, reason: "missing job block" };
  }
  for (const k of STRING_FIELDS_JOB) {
    if (typeof (job as Record<string, unknown>)[k] !== "string") {
      return { ok: false, reason: `job.${k} is not a string` };
    }
  }

  const customer = s.customer;
  if (!customer || typeof customer !== "object") {
    return { ok: false, reason: "missing customer block" };
  }
  for (const k of STRING_FIELDS_CUSTOMER) {
    if (typeof (customer as Record<string, unknown>)[k] !== "string") {
      return { ok: false, reason: `customer.${k} is not a string` };
    }
  }

  for (const k of ARRAY_FIELDS) {
    if (!Array.isArray(s[k])) {
      return { ok: false, reason: `${k} is not an array` };
    }
  }

  if (typeof s.totalAffectedSqFt !== "number") {
    return { ok: false, reason: "totalAffectedSqFt is not a number" };
  }

  return { ok: true };
}
