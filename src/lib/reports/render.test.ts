/**
 * Report-template integrity test — drives `renderReportHtml` against a
 * hand-built `ReportSnapshot` fixture to confirm:
 *
 *   1. Every `ReportType` produces non-empty HTML with the cover page.
 *   2. Estimate Proposal includes the PRD DoD totals exactly:
 *      $10,000 → +20% O&P = $12,000 → +8.625% tax = $1,035 → $13,035.
 *   3. Photo blocks include the data-URI `src=` for every photo.
 *   4. Helper output (USD, percent, scaleUnit) renders correctly.
 */

import { describe, expect, it } from "vitest";
import type { ReportType } from "@prisma/client";
import { renderReportHtml } from "./render";
import type { ReportSnapshot } from "./types";

function fixtureSnapshot(reportType: ReportType): ReportSnapshot {
  return {
    generatedAt: "2026-05-08T15:00:00.000Z",
    reportType,
    org: {
      id: "o1",
      name: "1-800 Water Damage of Nassau County",
      primaryColor: "#1e3a8a",
      reportFooter: "1-800-WATER-DAMAGE",
      licenseNumber: "NY-LIC-12345",
      logoUrl: null,
    },
    job: {
      id: "j1",
      jobNumber: "1800WD-2026-0142",
      lossType: "WATER",
      status: "ACTIVE",
      lossDate: "2026-05-01T00:00:00.000Z",
      firstResponseAt: "2026-05-01T03:30:00.000Z",
      closedAt: null,
      causeOfLoss: "Burst supply line under master bath sink",
      scopeNotes: "Extract standing water; demo wet drywall to 24\"",
    },
    customer: {
      firstName: "Maria",
      lastName: "Lopez",
      email: "maria@example.com",
      phone: "516-555-0144",
      addressLine1: "12 Maple Ave",
      addressLine2: null,
      city: "Garden City",
      state: "NY",
      postalCode: "11530",
      insuranceCarrier: "Allstate",
      policyNumber: "POL-9912",
      claimNumber: "CLM-4421",
      adjusterName: "Pat Adjuster",
      adjusterEmail: "pat@allstate.example",
      adjusterPhone: "212-555-0010",
    },
    rooms: [
      {
        id: "r1",
        name: "Master Bath",
        floor: "2",
        lengthFt: 8,
        widthFt: 10,
        heightFt: 8,
        category: "CAT_1",
        classOfLoss: "CLASS_2",
        affectedMaterials: ["Drywall", "Carpet pad"],
        notes: null,
      },
    ],
    photos: [
      {
        id: "p1",
        roomId: "r1",
        roomName: "Master Bath",
        caption: "Source — supply line",
        tags: ["source"],
        salvageability: null,
        takenAt: "2026-05-01T03:45:00.000Z",
        gpsLat: 40.7268,
        gpsLng: -73.6343,
        imageDataUrl: "data:image/webp;base64,AAAA",
      },
    ],
    readings: [
      {
        id: "rd1",
        roomName: "Master Bath",
        surface: "North wall, 24\" up",
        material: "DRYWALL",
        meterType: "PIN",
        scaleType: "PERCENT_MC",
        moistureValue: 38,
        isDryGoal: false,
        isInitial: true,
        isDry: false,
        takenAt: "2026-05-01T04:00:00.000Z",
        takenBy: "Tech Tom",
        notes: null,
      },
    ],
    dryingLogs: [
      {
        logDate: "2026-05-02T00:00:00.000Z",
        outsideTempF: 70,
        outsideRH: 60,
        outsideGPP: 95,
        unaffectedTempF: 72,
        unaffectedRH: 50,
        unaffectedGPP: 80,
        affectedTempF: 78,
        affectedRH: 40,
        affectedGPP: 70,
        hvacTempF: 72,
        hvacRH: 50,
        hvacGPP: 80,
        techNotes: "Two LGRs running",
      },
    ],
    placements: [
      {
        id: "pl1",
        assetTag: "AF-001",
        type: "AIR_MOVER",
        manufacturer: "Phoenix",
        model: "AirMax",
        roomName: "Master Bath",
        placedAt: "2026-05-01T05:00:00.000Z",
        removedAt: null,
      },
    ],
    forms: [
      {
        id: "f1",
        templateName: "Authorization to Perform Services",
        status: "COMPLETED",
        signedAt: "2026-05-01T03:55:00.000Z",
        signers: [{ name: "Maria Lopez", role: "Customer" }],
      },
    ],
    totalAffectedSqFt: 80,
    dailyEquipmentCounts: [
      { day: "2026-05-01", total: 2, byType: { AIR_MOVER: 1, DEHUMIDIFIER_LGR: 1 } },
    ],
  };
}

describe("renderReportHtml", () => {
  const types: ReportType[] = [
    "WATER_MITIGATION",
    "FIRE_LOSS",
    "MOLD_REMEDIATION",
    "PHOTO_REPORT",
    "MOISTURE_LOG",
    "EQUIPMENT_LOG",
    "ESTIMATE_PROPOSAL",
    "CONTENTS_INVENTORY",
    "CUSTOM",
  ];

  it.each(types)("renders %s with cover-page chrome", (t) => {
    const snap = fixtureSnapshot(t);
    if (t === "ESTIMATE_PROPOSAL") {
      snap.estimate = {
        overheadProfitRate: 0.2,
        salesTaxRate: 0.08625,
        paymentTerms: "50/50",
        lines: [
          {
            description: "Demo & dispose wet drywall",
            code: null,
            quantity: 100,
            unit: "SF",
            unitPrice: 100,
            extended: 10000,
          },
        ],
        subtotal: 10000,
        overheadProfit: 2000,
        subtotalWithOP: 12000,
        salesTax: 1035,
        total: 13035,
        paymentSplit: { atStart: 6517.5, atCompletion: 6517.5 },
      };
    }
    const html = renderReportHtml(snap);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("1-800 Water Damage of Nassau County");
    expect(html).toContain("1800WD-2026-0142");
    expect(html).toContain("Lopez, Maria");
  });

  it("estimate proposal shows the DoD totals", () => {
    const snap = fixtureSnapshot("ESTIMATE_PROPOSAL");
    snap.estimate = {
      overheadProfitRate: 0.2,
      salesTaxRate: 0.08625,
      paymentTerms: "50% due at start, 50% due at completion.",
      lines: [
        {
          description: "Demo & dispose wet drywall",
          code: null,
          quantity: 100,
          unit: "SF",
          unitPrice: 100,
          extended: 10000,
        },
      ],
      subtotal: 10000,
      overheadProfit: 2000,
      subtotalWithOP: 12000,
      salesTax: 1035,
      total: 13035,
      paymentSplit: { atStart: 6517.5, atCompletion: 6517.5 },
    };
    const html = renderReportHtml(snap);
    expect(html).toMatch(/\$10,000\.00/);
    expect(html).toMatch(/\$12,000\.00/);
    expect(html).toMatch(/\$1,035\.00/);
    expect(html).toMatch(/\$13,035\.00/);
    expect(html).toContain("Overhead &amp; profit (20%)");
    expect(html).toContain("Sales tax (8.625%)");
  });

  it("photo block embeds every imageDataUrl", () => {
    const snap = fixtureSnapshot("PHOTO_REPORT");
    snap.photos = [
      { ...snap.photos[0], id: "a", imageDataUrl: "data:image/webp;base64,AA" },
      { ...snap.photos[0], id: "b", imageDataUrl: "data:image/webp;base64,BB" },
      { ...snap.photos[0], id: "c", imageDataUrl: null },
    ];
    const html = renderReportHtml(snap);
    expect(html).toContain('src="data:image/webp;base64,AA"');
    expect(html).toContain('src="data:image/webp;base64,BB"');
    expect(html).toContain("image unavailable");
  });

  it("water mitigation shows readings + drying logs + equipment", () => {
    const snap = fixtureSnapshot("WATER_MITIGATION");
    const html = renderReportHtml(snap);
    expect(html).toContain("Moisture readings (1)");
    expect(html).toContain("Daily drying log");
    expect(html).toContain("Equipment placements (1)");
    expect(html).toContain("AF-001");
  });
});
