/**
 * Snapshot collector — gathers everything the report templates need from
 * the database (and storage, for photo data-URIs) into a single
 * serialisable `ReportSnapshot`. The snapshot is then stored as JSON on
 * the `Report.dataSnapshot` column so re-rendering a historical PDF is
 * deterministic even if the underlying job data has since drifted.
 *
 * The snapshot is intentionally derived data only — we do NOT keep
 * primary keys for relations (cuids) we don't need to print, and all
 * Date fields are flattened to ISO strings so JSON.stringify is exact.
 */

import "server-only";

import type { ReportType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import {
  dailyEquipmentCounts,
  type PlacementForCount,
} from "@/lib/business/equipment";
import {
  DEFAULT_PAYMENT_TERMS,
  computeEstimateTotals,
} from "@/lib/business/estimate";
import type {
  ReportConfig,
  ReportSnapshot,
  SnapshotDryingLog,
  SnapshotForm,
  SnapshotPhoto,
  SnapshotPlacement,
  SnapshotReading,
  SnapshotRoom,
} from "./types";

export interface CollectSnapshotInput {
  jobId: string;
  reportType: ReportType;
  config: ReportConfig;
}

const ISO = (d: Date | null | undefined): string | null =>
  d ? d.toISOString() : null;

const required = (d: Date): string => d.toISOString();

/**
 * Best-effort Buffer→data:URL encoder. Falls back to null on any storage
 * error so a missing/processing photo never aborts the whole snapshot.
 */
async function photoDataUrl(
  mimeType: string,
  preferredKey: string | null,
  fallbackKey: string,
): Promise<string | null> {
  const storage = getStorage();
  const key = preferredKey ?? fallbackKey;
  try {
    const bytes = await storage.getObjectBytes(key);
    // Sharp emits image/webp for the medium pipeline; the original mime is
    // only relevant when we fall back to the original storageKey.
    const effectiveMime = preferredKey ? "image/webp" : mimeType;
    return `data:${effectiveMime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Fetch the org logo bytes once and inline as a data: URI so the
 * locked-down Puppeteer page can render it without an outbound fetch
 * (PRD §11 / audit H4).
 *
 * `logoUrl` may be:
 *   - already a `data:` URI — pass through
 *   - a storage key (`branding/<orgId>/logo.png`) — fetch via storage
 *   - an http(s) URL — best-effort fetch; we trust the org admin's
 *     own setting here, but a render failure isn't fatal
 */
async function logoDataUrl(logoUrl: string | null): Promise<string | null> {
  if (!logoUrl) return null;
  if (logoUrl.startsWith("data:")) return logoUrl;
  const storage = getStorage();
  // Heuristic: if it looks like a storage key (no scheme), fetch via storage.
  const isUrl = /^https?:\/\//i.test(logoUrl);
  try {
    if (isUrl) {
      const res = await fetch(logoUrl);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = res.headers.get("content-type") ?? "image/png";
      return `data:${mime};base64,${buf.toString("base64")}`;
    }
    const bytes = await storage.getObjectBytes(logoUrl);
    // PNG/JPEG/SVG are the realistic logo formats; default to png.
    const guessedMime = /\.svg(\?|$)/i.test(logoUrl)
      ? "image/svg+xml"
      : /\.jpe?g(\?|$)/i.test(logoUrl)
        ? "image/jpeg"
        : "image/png";
    return `data:${guessedMime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function collectReportSnapshot(
  input: CollectSnapshotInput,
): Promise<ReportSnapshot> {
  const { jobId, reportType, config } = input;

  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      organization: true,
      customer: true,
      rooms: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });

  // -- Photos (with optional embedded data-URIs) --
  const photos: SnapshotPhoto[] = [];
  if (config.includePhotos !== false) {
    const dbPhotos = await prisma.photo.findMany({
      where: { jobId },
      include: { room: true },
      orderBy: [{ takenAt: "asc" }, { createdAt: "asc" }],
    });
    for (const p of dbPhotos) {
      const dataUrl = await photoDataUrl(p.mimeType, p.mediumKey, p.storageKey);
      photos.push({
        id: p.id,
        roomId: p.roomId,
        roomName: p.room?.name ?? null,
        caption: p.caption,
        tags: p.tags,
        salvageability: p.salvageability,
        takenAt: ISO(p.takenAt),
        gpsLat: p.gpsLat,
        gpsLng: p.gpsLng,
        imageDataUrl: dataUrl,
      });
    }
  }

  // -- Moisture readings --
  const readings: SnapshotReading[] = [];
  if (config.includeReadings !== false) {
    const dbReadings = await prisma.moistureReading.findMany({
      where: { jobId },
      include: { room: true, takenBy: { select: { name: true } } },
      orderBy: [{ takenAt: "asc" }],
    });
    for (const r of dbReadings) {
      readings.push({
        id: r.id,
        roomName: r.room?.name ?? null,
        surface: r.surface,
        material: r.material,
        meterType: r.meterType,
        scaleType: r.scaleType,
        moistureValue: r.moistureValue,
        isDryGoal: r.isDryGoal,
        isInitial: r.isInitial,
        isDry: r.isDry,
        takenAt: required(r.takenAt),
        takenBy: r.takenBy.name,
        notes: r.notes,
      });
    }
  }

  // -- Drying logs --
  const dryingLogs: SnapshotDryingLog[] = [];
  if (config.includeDryingLogs !== false) {
    const dbLogs = await prisma.dryingLog.findMany({
      where: { jobId },
      orderBy: [{ logDate: "asc" }],
    });
    for (const d of dbLogs) {
      dryingLogs.push({
        logDate: required(d.logDate),
        outsideTempF: d.outsideTempF,
        outsideRH: d.outsideRH,
        outsideGPP: d.outsideGPP,
        unaffectedTempF: d.unaffectedTempF,
        unaffectedRH: d.unaffectedRH,
        unaffectedGPP: d.unaffectedGPP,
        affectedTempF: d.affectedTempF,
        affectedRH: d.affectedRH,
        affectedGPP: d.affectedGPP,
        hvacTempF: d.hvacTempF,
        hvacRH: d.hvacRH,
        hvacGPP: d.hvacGPP,
        techNotes: d.techNotes,
      });
    }
  }

  // -- Equipment placements --
  const placements: SnapshotPlacement[] = [];
  let dailyCounts: ReportSnapshot["dailyEquipmentCounts"] = [];
  if (config.includeEquipment !== false) {
    const dbPlacements = await prisma.equipmentPlacement.findMany({
      where: { jobId },
      include: { equipment: true, room: true },
      orderBy: [{ placedAt: "asc" }],
    });
    for (const ep of dbPlacements) {
      placements.push({
        id: ep.id,
        assetTag: ep.equipment.assetTag,
        type: ep.equipment.type,
        manufacturer: ep.equipment.manufacturer,
        model: ep.equipment.model,
        roomName: ep.room?.name ?? null,
        placedAt: required(ep.placedAt),
        removedAt: ISO(ep.removedAt),
      });
    }

    if (dbPlacements.length > 0) {
      const placementsForCount: PlacementForCount[] = dbPlacements.map((ep) => ({
        equipmentId: ep.equipmentId,
        type: ep.equipment.type,
        placedAt: ep.placedAt,
        removedAt: ep.removedAt,
      }));
      const from = dbPlacements.reduce(
        (m, p) => (p.placedAt < m ? p.placedAt : m),
        dbPlacements[0].placedAt,
      );
      const to = dbPlacements.reduce<Date>((m, p) => {
        const stop = p.removedAt ?? new Date();
        return stop > m ? stop : m;
      }, dbPlacements[0].removedAt ?? new Date());
      dailyCounts = dailyEquipmentCounts(placementsForCount, from, to).map(
        (row) => ({
          day: row.day.toISOString().slice(0, 10),
          total: row.total,
          byType: row.byType,
        }),
      );
    }
  }

  // -- Forms (signed AOB / COC etc.) --
  const forms: SnapshotForm[] = [];
  if (config.includeForms !== false) {
    const dbForms = await prisma.formSubmission.findMany({
      where: { jobId },
      include: { template: true, signatures: true },
      orderBy: [{ createdAt: "asc" }],
    });
    for (const f of dbForms) {
      forms.push({
        id: f.id,
        templateName: f.template.name,
        status: f.status,
        signedAt: ISO(f.completedAt),
        signers: f.signatures.map((s) => ({
          name: s.signerName,
          role: s.signerRole,
        })),
      });
    }
  }

  // -- Rooms (always included; report intro lists them) --
  const rooms: SnapshotRoom[] = job.rooms.map((r) => ({
    id: r.id,
    name: r.name,
    floor: r.floor,
    lengthFt: r.lengthFt,
    widthFt: r.widthFt,
    heightFt: r.heightFt,
    category: r.category,
    classOfLoss: r.classOfLoss,
    affectedMaterials: Array.isArray(r.affectedMaterials)
      ? (r.affectedMaterials as string[]).filter((x) => typeof x === "string")
      : [],
    notes: r.notes,
  }));

  const totalAffectedSqFt = rooms.reduce((sum, r) => {
    if (r.lengthFt && r.widthFt) return sum + r.lengthFt * r.widthFt;
    return sum;
  }, 0);

  // -- Estimate totals (only when relevant) --
  let estimate: ReportSnapshot["estimate"];
  if (reportType === "ESTIMATE_PROPOSAL" && config.estimate) {
    const totals = computeEstimateTotals({
      lines: config.estimate.lines,
      overheadProfitRate: config.estimate.overheadProfitRate,
      salesTaxRate: config.estimate.salesTaxRate,
    });
    estimate = {
      overheadProfitRate: config.estimate.overheadProfitRate,
      salesTaxRate: config.estimate.salesTaxRate,
      paymentTerms: config.estimate.paymentTerms ?? DEFAULT_PAYMENT_TERMS,
      lines: config.estimate.lines.map((l, i) => ({
        description: l.description,
        code: l.code ?? null,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        extended: totals.lineExtended[i],
      })),
      subtotal: totals.subtotal,
      overheadProfit: totals.overheadProfit,
      subtotalWithOP: totals.subtotalWithOP,
      salesTax: totals.salesTax,
      total: totals.total,
      paymentSplit: totals.paymentSplit,
    };
  }

  const orgLogoDataUrl = await logoDataUrl(job.organization.logoUrl);

  return {
    generatedAt: new Date().toISOString(),
    reportType,
    org: {
      id: job.organization.id,
      name: job.organization.name,
      primaryColor: job.organization.primaryColor,
      reportFooter: job.organization.reportFooter,
      licenseNumber: job.organization.licenseNumber,
      logoUrl: job.organization.logoUrl,
      logoDataUrl: orgLogoDataUrl,
    },
    job: {
      id: job.id,
      jobNumber: job.jobNumber,
      lossType: job.lossType,
      status: job.status,
      lossDate: ISO(job.lossDate),
      firstResponseAt: ISO(job.firstResponseAt),
      closedAt: ISO(job.closedAt),
      causeOfLoss: job.causeOfLoss,
      scopeNotes: job.scopeNotes,
    },
    customer: {
      firstName: job.customer.firstName,
      lastName: job.customer.lastName,
      email: job.customer.email,
      phone: job.customer.phone,
      addressLine1: job.customer.addressLine1,
      addressLine2: job.customer.addressLine2,
      city: job.customer.city,
      state: job.customer.state,
      postalCode: job.customer.postalCode,
      insuranceCarrier: job.customer.insuranceCarrier,
      policyNumber: job.customer.policyNumber,
      claimNumber: job.customer.claimNumber,
      adjusterName: job.customer.adjusterName,
      adjusterEmail: job.customer.adjusterEmail,
      adjusterPhone: job.customer.adjusterPhone,
    },
    rooms,
    photos,
    readings,
    dryingLogs,
    placements,
    forms,
    totalAffectedSqFt: Math.round(totalAffectedSqFt * 100) / 100,
    dailyEquipmentCounts: dailyCounts,
    estimate,
  };
}
