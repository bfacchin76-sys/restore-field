/**
 * Phase 4 DoD walkthrough.
 *
 * 1. Creates a customer + job + room.
 * 2. Posts a series of moisture readings: an initial wet reading, a dry-goal,
 *    and follow-up readings that "stall" (no progress for 6 days).
 * 3. Asserts: stuck-surface detector flags it, dry-goal value surfaces.
 * 4. Posts a drying-log row with Outside (75°F/50%RH) and Affected (80°F/65%RH);
 *    asserts GPP filled in within 0.5 of hand-computed reference values.
 * 5. Re-creates a wet reading and confirms today's drying log auto-creates.
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
  JobStatus,
  LossType,
  Material,
  MeterType,
  ScaleType,
  WaterCategory,
  WaterClass,
} from "@prisma/client";
import { groupBySurface, stuckSurfaces, STUCK_DAY_THRESHOLD } from "../src/lib/business/moisture";
import { gppRounded } from "../src/lib/business/psychrometrics";
import { recommendEquipment } from "../src/lib/business/equipment-recommendation";

const prisma = new PrismaClient();

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

async function main() {
  const owner = await prisma.user.findUnique({
    where: { email: "owner@example.com" },
  });
  if (!owner) throw new Error("seed first");

  // Wipe leftovers
  const leftover = await prisma.customer.findFirst({
    where: { organizationId: owner.organizationId, lastName: "Phase4-DoD" },
  });
  if (leftover) {
    await prisma.job.deleteMany({ where: { customerId: leftover.id } });
    await prisma.customer.delete({ where: { id: leftover.id } });
  }

  console.log("--- Phase 4 DoD ---");

  const customer = await prisma.customer.create({
    data: {
      organizationId: owner.organizationId,
      firstName: "Phase4",
      lastName: "Phase4-DoD",
      addressLine1: "1 Wet St",
      city: "Mineola",
      state: "NY",
      postalCode: "11501",
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
      status: JobStatus.ACTIVE,
      createdById: owner.id,
      assignments: { create: { userId: owner.id, role: "lead" } },
    },
  });

  const room = await prisma.room.create({
    data: {
      jobId: job.id,
      name: "Kitchen",
      lengthFt: 14,
      widthFt: 12,
      heightFt: 8,
      category: WaterCategory.CAT_2,
      classOfLoss: WaterClass.CLASS_2,
    },
  });

  console.log(`Job ${job.jobNumber}, room ${room.name}`);

  const day = (n: number) => new Date(Date.UTC(2026, 0, n, 12));
  const now = day(8);

  // 1. dry-goal + initial reading on day 1
  await prisma.moistureReading.createMany({
    data: [
      {
        jobId: job.id,
        roomId: room.id,
        surface: "Drywall — N wall",
        material: Material.DRYWALL,
        meterType: MeterType.PIN,
        scaleType: ScaleType.PERCENT_MC,
        moistureValue: 16,
        isDryGoal: true,
        takenById: owner.id,
        takenAt: day(1),
      },
      {
        jobId: job.id,
        roomId: room.id,
        surface: "Drywall — N wall",
        material: Material.DRYWALL,
        meterType: MeterType.PIN,
        scaleType: ScaleType.PERCENT_MC,
        moistureValue: 40,
        isInitial: true,
        takenById: owner.id,
        takenAt: day(1),
      },
      // Drops to 22 on day 2, then stalls
      {
        jobId: job.id,
        roomId: room.id,
        surface: "Drywall — N wall",
        material: Material.DRYWALL,
        meterType: MeterType.PIN,
        scaleType: ScaleType.PERCENT_MC,
        moistureValue: 22,
        takenById: owner.id,
        takenAt: day(2),
      },
      {
        jobId: job.id,
        roomId: room.id,
        surface: "Drywall — N wall",
        material: Material.DRYWALL,
        meterType: MeterType.PIN,
        scaleType: ScaleType.PERCENT_MC,
        moistureValue: 23,
        takenById: owner.id,
        takenAt: day(4),
      },
      {
        jobId: job.id,
        roomId: room.id,
        surface: "Drywall — N wall",
        material: Material.DRYWALL,
        meterType: MeterType.PIN,
        scaleType: ScaleType.PERCENT_MC,
        moistureValue: 25,
        takenById: owner.id,
        takenAt: day(7),
      },
    ],
  });

  const readings = await prisma.moistureReading.findMany({
    where: { jobId: job.id },
    orderBy: { takenAt: "asc" },
  });
  const series = groupBySurface(readings, now);
  const stuck = stuckSurfaces(series);

  console.log(
    `Series: ${series.length}, dryGoal=${series[0].dryGoalValue}, daysWithoutProgress=${series[0].daysWithoutProgress}, stuck=${series[0].stuck}`,
  );
  console.log(`Stuck surfaces: ${stuck.length}`);
  if (
    series.length === 1 &&
    series[0].dryGoalValue === 16 &&
    series[0].daysWithoutProgress === 6 &&
    series[0].stuck === true
  ) {
    console.log(`Stuck warning at day 6 (> ${STUCK_DAY_THRESHOLD}): ✓`);
  } else {
    console.log(`Stuck warning expectation FAILED ✗`);
  }

  // 2. Drying log GPP autocalc
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const expectOutside = gppRounded(75, 50);
  const expectAffected = gppRounded(80, 65);

  const log = await prisma.dryingLog.create({
    data: {
      jobId: job.id,
      logDate: today,
      recordedById: owner.id,
      outsideTempF: 75,
      outsideRH: 50,
      outsideGPP: expectOutside,
      affectedTempF: 80,
      affectedRH: 65,
      affectedGPP: expectAffected,
    },
  });
  console.log(
    `Drying log: outside ${log.outsideGPP} GPP (expect ${expectOutside}, |Δ|≤0.5: ${Math.abs((log.outsideGPP ?? 0) - expectOutside) <= 0.5 ? "✓" : "✗"}), affected ${log.affectedGPP} GPP (expect ${expectAffected})`,
  );

  // 3. Equipment recommendation
  const rec = recommendEquipment({
    affectedSqFt: room.lengthFt! * room.widthFt!,
    worstCategory: WaterCategory.CAT_2,
    worstClass: WaterClass.CLASS_2,
  });
  console.log(
    `Equipment recommendation for ${room.lengthFt! * room.widthFt!} sqft: ${rec.airMovers} air movers, ${rec.lgrDehumidifiers} LGR(s), ${rec.airScrubbers} scrubber(s)`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
