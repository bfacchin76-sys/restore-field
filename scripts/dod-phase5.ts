/**
 * Phase 5 DoD walkthrough.
 *
 *   1. CSV import of 30 equipment items.
 *   2. Place 5 air movers on a job at day 1 09:00.
 *   3. Remove 2 of them at day 2 08:00.
 *   4. Assert daily counts: day 1 = 5, day 2 = 5 (overlap), day 3 = 3.
 *   5. Assert status transitions AVAILABLE → DEPLOYED → AVAILABLE.
 *   6. Run the daily-counts processor for day 2 and verify the audit row.
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
  JobStatus,
  LossType,
} from "@prisma/client";
import {
  dailyEquipmentCounts,
  equipmentCsvHeader,
  parseEquipmentCsv,
} from "../src/lib/business/equipment";
// Imported dynamically inside main() so the server-only stub above is
// already in Module._cache by the time daily-counts.ts loads.
type DailyCountsProcessor = (data: { day: string }) => Promise<void>;

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
    where: { organizationId: owner.organizationId, lastName: "Phase5-DoD" },
  });
  if (leftover) {
    await prisma.job.deleteMany({ where: { customerId: leftover.id } });
    await prisma.customer.delete({ where: { id: leftover.id } });
  }
  await prisma.equipment.deleteMany({
    where: {
      organizationId: owner.organizationId,
      assetTag: { startsWith: "P5-" },
    },
  });

  console.log("--- Phase 5 DoD ---");

  // 1. CSV import: 30 air movers
  const csvLines: string[] = [equipmentCsvHeader.join(",")];
  for (let i = 1; i <= 30; i++) {
    const tag = `P5-AM-${String(i).padStart(3, "0")}`;
    csvLines.push(`${tag},AIR_MOVER,Phoenix,Axial,SN-P5-${i},1.5,2900,,AVAILABLE,`);
  }
  const parsed = parseEquipmentCsv(csvLines.join("\n"));
  if (parsed.errors.length) throw new Error("CSV parse errors");

  for (const r of parsed.rows) {
    await prisma.equipment.create({
      data: { organizationId: owner.organizationId, ...r },
    });
  }
  const importedCount = await prisma.equipment.count({
    where: {
      organizationId: owner.organizationId,
      assetTag: { startsWith: "P5-" },
    },
  });
  console.log(`Imported ${importedCount} units (target 30): ${importedCount === 30 ? "✓" : "✗"}`);

  // 2. Create a job and place 5 air movers
  const customer = await prisma.customer.create({
    data: {
      organizationId: owner.organizationId,
      firstName: "Phase5",
      lastName: "Phase5-DoD",
      addressLine1: "5 Equipment Pl",
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
  console.log(`Job ${job.jobNumber}`);

  // Pick the first 5 air movers
  const fiveAirMovers = await prisma.equipment.findMany({
    where: {
      organizationId: owner.organizationId,
      assetTag: { startsWith: "P5-AM-" },
    },
    orderBy: { assetTag: "asc" },
    take: 5,
  });

  const day = (n: number, h = 0, m = 0) => new Date(Date.UTC(2026, 5, n, h, m));

  await prisma.$transaction(async (tx) => {
    for (const eq of fiveAirMovers) {
      await tx.equipmentPlacement.create({
        data: {
          jobId: job.id,
          equipmentId: eq.id,
          placedAt: day(1, 9),
        },
      });
      await tx.equipment.update({
        where: { id: eq.id },
        data: { status: EquipmentStatus.DEPLOYED },
      });
    }
  });
  console.log("Placed 5 air movers at day 1 09:00 UTC");

  // 3. Remove 2 of them at day 2 08:00
  const placementsToRemove = await prisma.equipmentPlacement.findMany({
    where: { jobId: job.id, removedAt: null },
    orderBy: { placedAt: "asc" },
    take: 2,
  });
  await prisma.$transaction(async (tx) => {
    for (const p of placementsToRemove) {
      await tx.equipmentPlacement.update({
        where: { id: p.id },
        data: { removedAt: day(2, 8) },
      });
      // Only flip status when no other open placements
      const stillOpen = await tx.equipmentPlacement.count({
        where: { equipmentId: p.equipmentId, removedAt: null },
      });
      if (stillOpen === 0) {
        await tx.equipment.update({
          where: { id: p.equipmentId },
          data: { status: EquipmentStatus.AVAILABLE },
        });
      }
    }
  });
  console.log("Removed 2 placements at day 2 08:00 UTC");

  // 4. Daily counts (compute against the actual placements)
  const allPlacements = await prisma.equipmentPlacement.findMany({
    where: { jobId: job.id },
    include: { equipment: { select: { type: true } } },
  });
  const counts = dailyEquipmentCounts(
    allPlacements.map((p) => ({
      equipmentId: p.equipmentId,
      type: p.equipment.type,
      placedAt: p.placedAt,
      removedAt: p.removedAt,
    })),
    day(1),
    day(3),
  );
  console.log(
    `Daily counts: day1=${counts[0].total}, day2=${counts[1].total}, day3=${counts[2].total}`,
  );
  console.log(
    `Expected day1=5 ${counts[0].total === 5 ? "✓" : "✗"} · day2=5 ${counts[1].total === 5 ? "✓" : "✗"} · day3=3 ${counts[2].total === 3 ? "✓" : "✗"}`,
  );

  // 5. Status transitions
  const finalStatuses = await prisma.equipment.findMany({
    where: { id: { in: fiveAirMovers.map((e) => e.id) } },
    orderBy: { assetTag: "asc" },
    select: { assetTag: true, status: true },
  });
  const removedTags = new Set(
    placementsToRemove.map(
      (p) => fiveAirMovers.find((e) => e.id === p.equipmentId)!.assetTag,
    ),
  );
  let okStatus = true;
  for (const e of finalStatuses) {
    const expected = removedTags.has(e.assetTag)
      ? EquipmentStatus.AVAILABLE
      : EquipmentStatus.DEPLOYED;
    if (e.status !== expected) {
      okStatus = false;
      console.log(
        `  ${e.assetTag}: status=${e.status} expected=${expected} ✗`,
      );
    }
  }
  console.log(`Status transitions correct: ${okStatus ? "✓" : "✗"}`);

  // 6. Run daily-counts processor for day 2 (assert audit row)
  await prisma.auditLog.deleteMany({
    where: { jobId: job.id, action: "equipment.daily_count" },
  });
  const { processDailyCountsJob } = (await import(
    "../src/lib/queue/processors/daily-counts"
  )) as { processDailyCountsJob: DailyCountsProcessor };
  await processDailyCountsJob({ day: day(2).toISOString().slice(0, 10) });
  const audit = await prisma.auditLog.findFirst({
    where: { jobId: job.id, action: "equipment.daily_count" },
  });
  if (audit) {
    const d = audit.details as { total?: number };
    console.log(
      `Daily-counts processor wrote audit row: total=${d.total} (expected 5) ${d.total === 5 ? "✓" : "✗"}`,
    );
  } else {
    console.log("Daily-counts processor: no audit row written ✗");
  }

  // Cleanup: leave nothing behind
  await prisma.auditLog.deleteMany({ where: { jobId: job.id } });
  await prisma.job.deleteMany({ where: { customerId: customer.id } });
  await prisma.customer.delete({ where: { id: customer.id } });
  await prisma.equipment.deleteMany({
    where: {
      organizationId: owner.organizationId,
      assetTag: { startsWith: "P5-" },
    },
  });
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
