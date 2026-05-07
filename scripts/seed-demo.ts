/**
 * Seed a representative end-to-end demo job — a single CAT 2 water loss in
 * Garden City, NY with 2 rooms, 6 photos (one with GPS), an initial set of
 * readings showing one stuck surface, today's drying log, and 3 air movers
 * deployed. Lets reviewers click around the running app immediately.
 *
 *   pnpm tsx scripts/seed-demo.ts
 *
 * Idempotent: re-running wipes the demo customer's prior data first.
 */

import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const Module = req("module") as {
  _cache: Record<string, unknown>;
  _resolveFilename: (s: string, p: unknown) => string;
};
const resolved = Module._resolveFilename("server-only", module);
Module._cache[resolved] = { exports: {}, loaded: true, id: resolved };

import {
  PrismaClient,
  Prisma,
  EquipmentStatus,
  EquipmentType,
  JobStatus,
  LossType,
  Material,
  MeterType,
  ScaleType,
  WaterCategory,
  WaterClass,
} from "@prisma/client";
import sharp from "sharp";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const piexif: typeof import("piexifjs") = require("piexifjs");

const prisma = new PrismaClient();

const DEMO_LAST = "Demo-Tour";

async function nextJobNumber(orgId: string, prefix: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const rows = await prisma.$queryRaw<{ nextSeq: number }[]>(Prisma.sql`
    INSERT INTO "JobNumberCounter" ("id","organizationId","year","nextSeq")
    VALUES (gen_random_uuid()::text, ${orgId}, ${year}, 2)
    ON CONFLICT ("organizationId","year") DO UPDATE
      SET "nextSeq" = "JobNumberCounter"."nextSeq" + 1
    RETURNING ("nextSeq"-1) AS "nextSeq"
  `);
  return `${prefix}-${year}-${String(rows[0].nextSeq).padStart(4, "0")}`;
}

async function makeDemoJpeg(seed: number, withGps: boolean): Promise<Buffer> {
  const base = await sharp({
    create: {
      width: 1280,
      height: 960,
      channels: 3,
      background: {
        r: (seed * 23 + 30) % 255,
        g: (seed * 17 + 50) % 255,
        b: (seed * 41 + 70) % 255,
      },
    },
  })
    .jpeg({ quality: 88 })
    .toBuffer();
  if (!withGps) return base;
  const exifObj = {
    "0th": {
      [piexif.ImageIFD.Make]: "Apple",
      [piexif.ImageIFD.Model]: "iPhone 15 Pro",
      [piexif.ImageIFD.DateTime]: "2026:05:07 14:30:00",
    },
    Exif: {
      [piexif.ExifIFD.DateTimeOriginal]: "2026:05:07 14:30:00",
    },
    GPS: {
      [piexif.GPSIFD.GPSLatitudeRef]: "N",
      [piexif.GPSIFD.GPSLatitude]: [
        [40, 1],
        [44, 1],
        [0, 1],
      ],
      [piexif.GPSIFD.GPSLongitudeRef]: "W",
      [piexif.GPSIFD.GPSLongitude]: [
        [73, 1],
        [38, 1],
        [0, 1],
      ],
    },
  };
  const exifBytes = piexif.dump(exifObj);
  return Buffer.from(piexif.insert(exifBytes, base.toString("binary")), "binary");
}

async function main() {
  const owner = await prisma.user.findUnique({
    where: { email: "owner@example.com" },
  });
  if (!owner) throw new Error("seed first: pnpm db:seed");

  // ---- wipe prior tour data -------------------------------------------------
  const prior = await prisma.customer.findFirst({
    where: { organizationId: owner.organizationId, lastName: DEMO_LAST },
  });
  if (prior) {
    await prisma.job.deleteMany({ where: { customerId: prior.id } });
    await prisma.customer.delete({ where: { id: prior.id } });
  }
  // Free up demo equipment
  await prisma.equipment.deleteMany({
    where: {
      organizationId: owner.organizationId,
      assetTag: { startsWith: "DEMO-" },
    },
  });

  console.log("--- seeding demo tour data ---");

  // ---- customer + job -------------------------------------------------------
  const customer = await prisma.customer.create({
    data: {
      organizationId: owner.organizationId,
      firstName: "Sarah",
      lastName: DEMO_LAST,
      email: "sarah.demo@example.com",
      phone: "(516) 555-0142",
      addressLine1: "412 Stewart Ave",
      city: "Garden City",
      state: "NY",
      postalCode: "11530",
      insuranceCarrier: "Allstate",
      policyNumber: "POL-DEMO-7891",
      claimNumber: "CL-DEMO-0042",
      adjusterName: "Mike Carrasco",
      adjusterEmail: "mcarrasco@allstate.example",
      adjusterPhone: "(800) 555-0177",
    },
  });

  const org = await prisma.organization.findUnique({
    where: { id: owner.organizationId },
    select: { jobNumberPrefix: true },
  });
  const jobNumber = await nextJobNumber(
    owner.organizationId,
    org!.jobNumberPrefix,
  );
  const job = await prisma.job.create({
    data: {
      jobNumber,
      organizationId: owner.organizationId,
      customerId: customer.id,
      lossType: LossType.WATER,
      status: JobStatus.DRYING,
      lossDate: new Date(Date.UTC(2026, 4, 5)),
      firstResponseAt: new Date(Date.UTC(2026, 4, 5, 13, 30)),
      causeOfLoss: "Supply line burst under kitchen sink",
      scopeNotes:
        "Cat 2 water from pressurised supply line. Saturation in kitchen base cabinets and across living-room carpet/pad. Flood cuts on lower 2 ft of drywall on N + W walls.",
      createdById: owner.id,
      assignments: { create: { userId: owner.id, role: "lead" } },
    },
  });
  console.log(`Job ${job.jobNumber}`);

  const kitchen = await prisma.room.create({
    data: {
      jobId: job.id,
      name: "Kitchen",
      floor: "1st",
      lengthFt: 14,
      widthFt: 12,
      heightFt: 8,
      category: WaterCategory.CAT_2,
      classOfLoss: WaterClass.CLASS_2,
      affectedMaterials: ["drywall", "cabinetry", "subfloor_plywood"],
      sortOrder: 0,
      notes: "Lower cabinets pulled, kick plates removed.",
    },
  });
  const livingRoom = await prisma.room.create({
    data: {
      jobId: job.id,
      name: "Living Room",
      floor: "1st",
      lengthFt: 18,
      widthFt: 14,
      heightFt: 8,
      category: WaterCategory.CAT_2,
      classOfLoss: WaterClass.CLASS_2,
      affectedMaterials: ["drywall", "carpet", "carpet_pad"],
      sortOrder: 1,
    },
  });

  // ---- photos (write directly via storage adapter) --------------------------
  const { getStorage } = await import("../src/lib/storage");
  const { tmpKey, originalKey, mediumKey, thumbKey } = await import(
    "../src/lib/photos/keys"
  );
  const { processImage } = await import("../src/lib/photos/process");
  const storage = getStorage();

  const captions = [
    "Kitchen — N wall after flood cut",
    "Kitchen — under-sink supply line",
    "Kitchen — saturated subfloor, base cabinets out",
    "Living room — saturated carpet at threshold",
    "Living room — moisture meter on N wall drywall",
    "Front of property",
  ];
  for (let i = 0; i < captions.length; i++) {
    const photoRow = await prisma.photo.create({
      data: {
        jobId: job.id,
        roomId: i < 3 ? kitchen.id : i < 5 ? livingRoom.id : null,
        uploadedById: owner.id,
        storageKey: "",
        mimeType: "image/jpeg",
        sizeBytes: 0,
      },
    });
    const bytes = await makeDemoJpeg(i + 1, i === captions.length - 1);
    const uploadKey = tmpKey(photoRow.id, "jpg");
    await storage.putObjectBytes(uploadKey, bytes, "image/jpeg");

    const r = await processImage(bytes, "image/jpeg");
    const oKey = originalKey(
      owner.organizationId,
      job.id,
      photoRow.id,
      r.originalExt,
    );
    const mKey = mediumKey(owner.organizationId, job.id, photoRow.id);
    const tKey = thumbKey(owner.organizationId, job.id, photoRow.id);
    await Promise.all([
      storage.putObjectBytes(oKey, r.originalBytes, r.originalMime),
      storage.putObjectBytes(mKey, r.mediumBytes, "image/webp"),
      storage.putObjectBytes(tKey, r.thumbBytes, "image/webp"),
    ]);
    await storage.deleteObject(uploadKey).catch(() => {});

    await prisma.photo.update({
      where: { id: photoRow.id },
      data: {
        storageKey: oKey,
        mediumKey: mKey,
        thumbnailKey: tKey,
        mimeType: r.originalMime,
        sizeBytes: r.originalBytes.byteLength,
        width: r.width,
        height: r.height,
        takenAt: r.takenAt ?? undefined,
        gpsLat: r.gpsLat ?? undefined,
        gpsLng: r.gpsLng ?? undefined,
        deviceModel: r.deviceModel ?? undefined,
        caption: captions[i],
        processedAt: new Date(),
      },
    });
  }
  console.log(`Wrote ${captions.length} photos`);

  // ---- moisture readings (one stuck surface) --------------------------------
  const day = (n: number) => new Date(Date.UTC(2026, 4, n, 11));
  await prisma.moistureReading.createMany({
    data: [
      // Kitchen drywall — improving
      { jobId: job.id, roomId: kitchen.id, surface: "Drywall — N wall", material: Material.DRYWALL, meterType: MeterType.PIN, scaleType: ScaleType.PERCENT_MC, moistureValue: 15, isDryGoal: true, takenById: owner.id, takenAt: day(5) },
      { jobId: job.id, roomId: kitchen.id, surface: "Drywall — N wall", material: Material.DRYWALL, meterType: MeterType.PIN, scaleType: ScaleType.PERCENT_MC, moistureValue: 38, isInitial: true, takenById: owner.id, takenAt: day(5) },
      { jobId: job.id, roomId: kitchen.id, surface: "Drywall — N wall", material: Material.DRYWALL, meterType: MeterType.PIN, scaleType: ScaleType.PERCENT_MC, moistureValue: 28, takenById: owner.id, takenAt: day(6) },
      { jobId: job.id, roomId: kitchen.id, surface: "Drywall — N wall", material: Material.DRYWALL, meterType: MeterType.PIN, scaleType: ScaleType.PERCENT_MC, moistureValue: 19, takenById: owner.id, takenAt: day(7) },
      // Kitchen subfloor — stuck (no progress since day 6)
      { jobId: job.id, roomId: kitchen.id, surface: "Subfloor — under sink", material: Material.SUBFLOOR_PLYWOOD, meterType: MeterType.PIN, scaleType: ScaleType.PERCENT_MC, moistureValue: 16, isDryGoal: true, takenById: owner.id, takenAt: day(5) },
      { jobId: job.id, roomId: kitchen.id, surface: "Subfloor — under sink", material: Material.SUBFLOOR_PLYWOOD, meterType: MeterType.PIN, scaleType: ScaleType.PERCENT_MC, moistureValue: 42, isInitial: true, takenById: owner.id, takenAt: day(5) },
      { jobId: job.id, roomId: kitchen.id, surface: "Subfloor — under sink", material: Material.SUBFLOOR_PLYWOOD, meterType: MeterType.PIN, scaleType: ScaleType.PERCENT_MC, moistureValue: 26, takenById: owner.id, takenAt: day(6) },
      { jobId: job.id, roomId: kitchen.id, surface: "Subfloor — under sink", material: Material.SUBFLOOR_PLYWOOD, meterType: MeterType.PIN, scaleType: ScaleType.PERCENT_MC, moistureValue: 27, takenById: owner.id, takenAt: day(7) },
      // Living room carpet pad — improving
      { jobId: job.id, roomId: livingRoom.id, surface: "Carpet pad", material: Material.CARPET_PAD, meterType: MeterType.PINLESS, scaleType: ScaleType.PERCENT_WME, moistureValue: 14, isDryGoal: true, takenById: owner.id, takenAt: day(5) },
      { jobId: job.id, roomId: livingRoom.id, surface: "Carpet pad", material: Material.CARPET_PAD, meterType: MeterType.PINLESS, scaleType: ScaleType.PERCENT_WME, moistureValue: 31, isInitial: true, takenById: owner.id, takenAt: day(5) },
      { jobId: job.id, roomId: livingRoom.id, surface: "Carpet pad", material: Material.CARPET_PAD, meterType: MeterType.PINLESS, scaleType: ScaleType.PERCENT_WME, moistureValue: 22, takenById: owner.id, takenAt: day(6) },
      { jobId: job.id, roomId: livingRoom.id, surface: "Carpet pad", material: Material.CARPET_PAD, meterType: MeterType.PINLESS, scaleType: ScaleType.PERCENT_WME, moistureValue: 13, isDry: true, takenById: owner.id, takenAt: day(7) },
    ],
  });
  console.log("Wrote 12 moisture readings");

  // ---- drying logs (today + 2 days back) ------------------------------------
  for (const n of [5, 6, 7]) {
    await prisma.dryingLog.create({
      data: {
        jobId: job.id,
        logDate: new Date(Date.UTC(2026, 4, n)),
        recordedById: owner.id,
        outsideTempF: 68 + n,
        outsideRH: 55,
        outsideGPP: null,
        unaffectedTempF: 72,
        unaffectedRH: 45,
        unaffectedGPP: null,
        affectedTempF: 78,
        affectedRH: 62 - (n - 5) * 4,
        affectedGPP: null,
        hvacTempF: 70,
        hvacRH: 40,
        hvacGPP: null,
        techNotes: n === 7 ? "Air movers turned 90° in kitchen." : null,
      },
    });
  }
  // Backfill GPP for these logs
  const { gppRounded } = await import("../src/lib/business/psychrometrics");
  const logs = await prisma.dryingLog.findMany({ where: { jobId: job.id } });
  for (const l of logs) {
    await prisma.dryingLog.update({
      where: { id: l.id },
      data: {
        outsideGPP:
          l.outsideTempF != null && l.outsideRH != null
            ? gppRounded(l.outsideTempF, l.outsideRH)
            : null,
        unaffectedGPP:
          l.unaffectedTempF != null && l.unaffectedRH != null
            ? gppRounded(l.unaffectedTempF, l.unaffectedRH)
            : null,
        affectedGPP:
          l.affectedTempF != null && l.affectedRH != null
            ? gppRounded(l.affectedTempF, l.affectedRH)
            : null,
        hvacGPP:
          l.hvacTempF != null && l.hvacRH != null
            ? gppRounded(l.hvacTempF, l.hvacRH)
            : null,
      },
    });
  }
  console.log("Wrote 3 drying logs with GPP");

  // ---- equipment + placements ----------------------------------------------
  const demoEquipment = [
    { assetTag: "DEMO-AM-01", type: EquipmentType.AIR_MOVER, manufacturer: "Phoenix", model: "Axial AirMax", cfm: 2900, amperage: 1.5 },
    { assetTag: "DEMO-AM-02", type: EquipmentType.AIR_MOVER, manufacturer: "Phoenix", model: "Axial AirMax", cfm: 2900, amperage: 1.5 },
    { assetTag: "DEMO-AM-03", type: EquipmentType.AIR_MOVER, manufacturer: "Phoenix", model: "Axial AirMax", cfm: 2900, amperage: 1.5 },
    { assetTag: "DEMO-DH-01", type: EquipmentType.DEHUMIDIFIER_LGR, manufacturer: "Dri-Eaz", model: "LGR 7000XLi", ppd: 235, amperage: 7.0 },
  ];
  const equipmentRows = [];
  for (const e of demoEquipment) {
    const row = await prisma.equipment.create({
      data: {
        organizationId: owner.organizationId,
        ...e,
        status: EquipmentStatus.AVAILABLE,
      },
    });
    equipmentRows.push(row);
  }
  // Place all 4 on the job
  for (let i = 0; i < equipmentRows.length; i++) {
    const eq = equipmentRows[i];
    await prisma.equipmentPlacement.create({
      data: {
        jobId: job.id,
        equipmentId: eq.id,
        roomId: i < 2 ? kitchen.id : livingRoom.id,
        placedAt: new Date(Date.UTC(2026, 4, 5, 14)),
      },
    });
    await prisma.equipment.update({
      where: { id: eq.id },
      data: { status: EquipmentStatus.DEPLOYED },
    });
  }
  console.log(`Placed ${equipmentRows.length} equipment items`);

  console.log("\n--- demo data ready ---");
  console.log(`Customer:      Sarah Demo-Tour`);
  console.log(`Job number:    ${job.jobNumber}`);
  console.log(`Job ID:        ${job.id}`);
  console.log(`Visit:         http://localhost:3000/app/jobs/${job.id}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
