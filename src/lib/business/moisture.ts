/**
 * Moisture-reading business logic.
 *
 *   - groupBySurface(): cluster readings by (room, surface) so the chart
 *     can plot a line per surface.
 *   - dryGoalFor(): the threshold a surface needs to reach to be "dry"
 *     (per IICRC S500 — usually within 4 %MC of the unaffected reference).
 *   - daysWithoutProgress(): how many days since the surface started
 *     trending up; surfaces stuck > 5 days surface a warning per PRD §8.4.
 */

import type { MoistureReading } from "@prisma/client";

export type ReadingForChart = Pick<
  MoistureReading,
  | "id"
  | "roomId"
  | "surface"
  | "moistureValue"
  | "scaleType"
  | "isDryGoal"
  | "isInitial"
  | "isDry"
  | "takenAt"
>;

export interface SurfaceSeries {
  /** Stable identifier across renders. */
  key: string;
  surface: string;
  roomId: string | null;
  readings: ReadingForChart[];
  /** First reading flagged isDryGoal — if any. */
  dryGoalValue: number | null;
  /** Latest reading. */
  latestValue: number;
  latestTakenAt: Date;
  /** Has the latest reading reached or beaten the goal? */
  reachedGoal: boolean;
  /** Days since the most recent improvement (i.e. since a reading lower than
   *  any subsequent reading was taken). 0 = improving today. */
  daysWithoutProgress: number;
  /** True when daysWithoutProgress > STUCK_DAY_THRESHOLD (PRD §8.4). */
  stuck: boolean;
}

/** A surface that hasn't dropped in N+ days surfaces a warning. PRD §8.4. */
export const STUCK_DAY_THRESHOLD = 5;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Bucket readings by (roomId|null) + surface. Within each bucket they're
 * sorted oldest → newest. The dry-goal value (if marked) is surfaced on
 * the series for the chart's threshold line.
 */
export function groupBySurface(
  readings: ReadingForChart[],
  now: Date = new Date(),
): SurfaceSeries[] {
  const buckets = new Map<string, ReadingForChart[]>();
  for (const r of readings) {
    const k = `${r.roomId ?? ""}::${r.surface}`;
    const arr = buckets.get(k);
    if (arr) arr.push(r);
    else buckets.set(k, [r]);
  }

  return Array.from(buckets.entries()).map(([key, raw]) => {
    raw.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
    const dryGoal = raw.find((r) => r.isDryGoal);
    const latest = raw[raw.length - 1];

    // Find the most recent measurement whose value is the running minimum
    // — anything taken AFTER that point is not lower → no progress since.
    // We exclude `isDryGoal` markers (those record the target on an
    // unaffected wall and would always dominate the minimum). The number
    // of *whole days* between that reading and `now` is the surface's
    // "days without progress".
    const measurements = raw.filter((r) => !r.isDryGoal);
    let runMin = Number.POSITIVE_INFINITY;
    let lastImprovement: Date = measurements[0]?.takenAt ?? raw[0].takenAt;
    for (let i = measurements.length - 1; i >= 0; i--) {
      if (measurements[i].moistureValue < runMin) {
        runMin = measurements[i].moistureValue;
        lastImprovement = measurements[i].takenAt;
      }
    }
    const dwp = Math.max(0, daysBetween(lastImprovement, now));

    const reachedGoal =
      dryGoal != null && latest.moistureValue <= dryGoal.moistureValue;

    return {
      key,
      surface: raw[0].surface,
      roomId: raw[0].roomId,
      readings: raw,
      dryGoalValue: dryGoal?.moistureValue ?? null,
      latestValue: latest.moistureValue,
      latestTakenAt: latest.takenAt,
      reachedGoal,
      daysWithoutProgress: dwp,
      stuck:
        !reachedGoal && dwp > STUCK_DAY_THRESHOLD,
    };
  });
}

/**
 * Returns the human-readable list of surface keys that are stuck (for a
 * banner / report section).
 */
export function stuckSurfaces(series: SurfaceSeries[]): SurfaceSeries[] {
  return series.filter((s) => s.stuck);
}

/** Convenience: distinct day count covered by a list of readings. */
export function distinctDayCount(readings: ReadingForChart[]): number {
  const days = new Set<string>();
  for (const r of readings) days.add(dayKey(r.takenAt));
  return days.size;
}
