import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { dailyEquipmentCounts } from "@/lib/business/equipment";
import type { DailyCountsJob } from "../queues";

/**
 * Daily snapshot — for each org, log a per-job count of currently-deployed
 * equipment for the given day (PRD §8.5). We don't persist a separate
 * snapshot table in v1: counts are deterministic from EquipmentPlacement
 * timestamps. Instead we write a structured AuditLog row per job that has
 * any open or recent placements, so invoice generation later can aggregate
 * over the audit feed without rescanning placements.
 *
 * `data.day` may be empty when the cron template fires (BullMQ replays
 * the same template every run, so we deliberately leave the date blank
 * and compute it from `now()` here — yesterday's UTC date, since the
 * cron fires at 00:05 UTC).
 */
export async function processDailyCountsJob(
  data: DailyCountsJob,
): Promise<void> {
  const dayString =
    data.day && data.day.length > 0
      ? data.day
      : (() => {
          // The cron fires at 00:05 UTC; we want the day that just ended.
          const yesterday = new Date(Date.now() - 60 * 60 * 1000);
          return yesterday.toISOString().slice(0, 10);
        })();

  const day = new Date(`${dayString}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) {
    throw new Error(`Invalid day: ${dayString}`);
  }
  const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);

  // Find every job that had at least one placement overlapping the day.
  const jobs = await prisma.job.findMany({
    where: {
      equipmentPlacements: {
        some: {
          placedAt: { lt: dayEnd },
          OR: [{ removedAt: null }, { removedAt: { gt: day } }],
        },
      },
    },
    select: {
      id: true,
      jobNumber: true,
      organizationId: true,
      equipmentPlacements: {
        where: {
          placedAt: { lt: dayEnd },
          OR: [{ removedAt: null }, { removedAt: { gt: day } }],
        },
        select: {
          equipmentId: true,
          placedAt: true,
          removedAt: true,
          equipment: { select: { type: true } },
        },
      },
    },
  });

  for (const job of jobs) {
    const counts = dailyEquipmentCounts(
      job.equipmentPlacements.map((p) => ({
        equipmentId: p.equipmentId,
        type: p.equipment.type,
        placedAt: p.placedAt,
        removedAt: p.removedAt,
      })),
      day,
      day,
    );
    const row = counts[0];
    if (!row || row.total === 0) continue;
    await prisma.auditLog.create({
      data: {
        userId: null,
        jobId: job.id,
        action: "equipment.daily_count",
        details: {
          day: dayString,
          jobNumber: job.jobNumber,
          total: row.total,
          byType: row.byType,
        },
      },
    });
  }

  logger.info(
    { day: dayString, jobs: jobs.length },
    "equipment daily counts snapshot done",
  );
}
