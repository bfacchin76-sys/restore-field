/**
 * Snapshot shape-guard tests (audit M3). These let the report-generate
 * worker fail loud-and-named instead of crashing inside Handlebars
 * with `undefined.map()` when an old / malformed row gets dequeued.
 */
import { describe, expect, it } from "vitest";
import { isValidReportSnapshot } from "./snapshot-shape";

const valid = {
  generatedAt: "2026-05-08T15:00:00.000Z",
  reportType: "WATER_MITIGATION",
  org: {
    id: "o",
    name: "Org",
    primaryColor: "#1e3a8a",
    reportFooter: null,
    licenseNumber: null,
    logoUrl: null,
    logoDataUrl: null,
  },
  job: {
    id: "j",
    jobNumber: "1800WD-2026-0001",
    lossType: "WATER",
    status: "ACTIVE",
    lossDate: null,
    firstResponseAt: null,
    closedAt: null,
    causeOfLoss: null,
    scopeNotes: null,
  },
  customer: {
    firstName: "A",
    lastName: "B",
    addressLine1: "1 St",
    city: "Anytown",
    state: "NY",
    postalCode: "10000",
    email: null,
    phone: null,
    addressLine2: null,
    insuranceCarrier: null,
    policyNumber: null,
    claimNumber: null,
    adjusterName: null,
    adjusterEmail: null,
    adjusterPhone: null,
  },
  rooms: [],
  photos: [],
  readings: [],
  dryingLogs: [],
  placements: [],
  forms: [],
  totalAffectedSqFt: 0,
  dailyEquipmentCounts: [],
};

describe("isValidReportSnapshot", () => {
  it("accepts a complete snapshot", () => {
    expect(isValidReportSnapshot(valid).ok).toBe(true);
  });

  it("rejects null / non-object input", () => {
    expect(isValidReportSnapshot(null)).toEqual({
      ok: false,
      reason: "snapshot is not an object",
    });
    expect(isValidReportSnapshot("string")).toEqual({
      ok: false,
      reason: "snapshot is not an object",
    });
  });

  it("rejects missing top-level required fields", () => {
    const noOrg = { ...valid, org: undefined };
    expect(isValidReportSnapshot(noOrg).ok).toBe(false);

    const noJob = { ...valid, job: undefined };
    expect(isValidReportSnapshot(noJob).ok).toBe(false);

    const noGenAt = { ...valid, generatedAt: undefined };
    expect(isValidReportSnapshot(noGenAt).ok).toBe(false);
  });

  it("rejects when an array field is missing or wrong type", () => {
    const noPhotos = { ...valid, photos: undefined };
    expect(isValidReportSnapshot(noPhotos)).toEqual({
      ok: false,
      reason: "photos is not an array",
    });

    const photosString = { ...valid, photos: "[]" };
    expect(isValidReportSnapshot(photosString).ok).toBe(false);
  });

  it("rejects malformed customer block", () => {
    const noLastName = {
      ...valid,
      customer: { ...valid.customer, lastName: undefined },
    };
    const r = isValidReportSnapshot(noLastName);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/customer\.lastName/);
  });

  it("rejects when totalAffectedSqFt is not a number", () => {
    const bad = { ...valid, totalAffectedSqFt: "100" };
    const r = isValidReportSnapshot(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/totalAffectedSqFt/);
  });
});
