/**
 * Cross-cutting types shared by the snapshot collector, the Handlebars
 * templates, and the PDF renderer.
 *
 * All Date values are serialised as ISO strings inside the snapshot so
 * the JSON column round-trips through Prisma without surprises.
 */

import type {
  EquipmentType,
  Material,
  MeterType,
  ReportType,
  Salvageability,
  ScaleType,
  WaterCategory,
  WaterClass,
} from "@prisma/client";

export interface ReportConfig {
  /** What the user toggled on the generate form. Most reports take a
   *  subset; the boolean flags below are the full union. */
  includePhotos?: boolean;
  includeReadings?: boolean;
  includeDryingLogs?: boolean;
  includeEquipment?: boolean;
  includeForms?: boolean;
  includeSignatures?: boolean;
  /** Free-text note shown at the top of the report. */
  scopeSummary?: string;

  // Estimate Proposal-only:
  estimate?: {
    overheadProfitRate: number;
    salesTaxRate: number;
    paymentTerms?: string;
    lines: Array<{
      description: string;
      code?: string | null;
      quantity: number;
      unit: string;
      unitPrice: number;
    }>;
  };
}

export interface SnapshotPhoto {
  id: string;
  roomId: string | null;
  roomName: string | null;
  caption: string | null;
  tags: string[];
  salvageability: Salvageability | null;
  takenAt: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  /** Embedded data: URI of the medium-quality WebP. */
  imageDataUrl: string | null;
}

export interface SnapshotReading {
  id: string;
  roomName: string | null;
  surface: string;
  material: Material;
  meterType: MeterType;
  scaleType: ScaleType;
  moistureValue: number;
  isDryGoal: boolean;
  isInitial: boolean;
  isDry: boolean;
  takenAt: string;
  takenBy: string;
  notes: string | null;
}

export interface SnapshotDryingLog {
  logDate: string;
  outsideTempF: number | null;
  outsideRH: number | null;
  outsideGPP: number | null;
  unaffectedTempF: number | null;
  unaffectedRH: number | null;
  unaffectedGPP: number | null;
  affectedTempF: number | null;
  affectedRH: number | null;
  affectedGPP: number | null;
  hvacTempF: number | null;
  hvacRH: number | null;
  hvacGPP: number | null;
  techNotes: string | null;
}

export interface SnapshotPlacement {
  id: string;
  assetTag: string;
  type: EquipmentType;
  manufacturer: string | null;
  model: string | null;
  roomName: string | null;
  placedAt: string;
  removedAt: string | null;
}

export interface SnapshotRoom {
  id: string;
  name: string;
  floor: string | null;
  lengthFt: number | null;
  widthFt: number | null;
  heightFt: number | null;
  category: WaterCategory | null;
  classOfLoss: WaterClass | null;
  affectedMaterials: string[];
  notes: string | null;
}

export interface SnapshotForm {
  id: string;
  templateName: string;
  status: string;
  signedAt: string | null;
  signers: Array<{ name: string; role: string }>;
}

export interface ReportSnapshot {
  /** When the report was generated. */
  generatedAt: string;
  reportType: ReportType;
  org: {
    id: string;
    name: string;
    primaryColor: string;
    reportFooter: string | null;
    licenseNumber: string | null;
    logoUrl: string | null;
    /** Embedded data: URI of the org logo so the locked-down Puppeteer
     *  page can render it without an outbound fetch. Filled in by the
     *  snapshot collector when `logoUrl` resolves to a storage key. */
    logoDataUrl: string | null;
  };
  job: {
    id: string;
    jobNumber: string;
    lossType: string;
    status: string;
    lossDate: string | null;
    firstResponseAt: string | null;
    closedAt: string | null;
    causeOfLoss: string | null;
    scopeNotes: string | null;
  };
  customer: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    postalCode: string;
    insuranceCarrier: string | null;
    policyNumber: string | null;
    claimNumber: string | null;
    adjusterName: string | null;
    adjusterEmail: string | null;
    adjusterPhone: string | null;
  };
  rooms: SnapshotRoom[];
  photos: SnapshotPhoto[];
  readings: SnapshotReading[];
  dryingLogs: SnapshotDryingLog[];
  placements: SnapshotPlacement[];
  forms: SnapshotForm[];
  /** Total affected sqft (sum of room L×W). */
  totalAffectedSqFt: number;
  /** Per-day count of distinct deployed units. */
  dailyEquipmentCounts: Array<{
    day: string;
    total: number;
    byType: Partial<Record<EquipmentType, number>>;
  }>;
  /** Estimate Proposal data, computed from config.estimate when present. */
  estimate?: {
    overheadProfitRate: number;
    salesTaxRate: number;
    paymentTerms: string;
    lines: Array<{
      description: string;
      code: string | null;
      quantity: number;
      unit: string;
      unitPrice: number;
      extended: number;
    }>;
    subtotal: number;
    overheadProfit: number;
    subtotalWithOP: number;
    salesTax: number;
    total: number;
    paymentSplit: { atStart: number; atCompletion: number };
  };
}
