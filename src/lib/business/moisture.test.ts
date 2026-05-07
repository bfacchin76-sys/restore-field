import { describe, expect, it } from "vitest";
import {
  STUCK_DAY_THRESHOLD,
  distinctDayCount,
  groupBySurface,
  stuckSurfaces,
  type ReadingForChart,
} from "./moisture";

function r(
  partial: Partial<ReadingForChart> & {
    surface: string;
    moistureValue: number;
    takenAt: Date;
  },
): ReadingForChart {
  return {
    id: `r_${Math.random().toString(36).slice(2, 8)}`,
    roomId: partial.roomId ?? null,
    surface: partial.surface,
    moistureValue: partial.moistureValue,
    scaleType: "PERCENT_MC",
    isDryGoal: partial.isDryGoal ?? false,
    isInitial: partial.isInitial ?? false,
    isDry: partial.isDry ?? false,
    takenAt: partial.takenAt,
  };
}

const day = (n: number) => new Date(2026, 4, n, 10, 0);

describe("groupBySurface", () => {
  it("buckets by (room, surface) and sorts oldest → newest", () => {
    const series = groupBySurface(
      [
        r({ surface: "Drywall N", moistureValue: 35, takenAt: day(3) }),
        r({ surface: "Drywall N", moistureValue: 40, takenAt: day(1) }),
        r({ surface: "Drywall S", moistureValue: 18, takenAt: day(1) }),
      ],
      day(7),
    );
    expect(series).toHaveLength(2);
    const drywallN = series.find((s) => s.surface === "Drywall N")!;
    expect(drywallN.readings.map((r) => r.moistureValue)).toEqual([40, 35]);
  });

  it("treats null roomId as a separate bucket from a real roomId", () => {
    const a = r({ surface: "Wall", moistureValue: 20, takenAt: day(1), roomId: "room_a" });
    const b = r({ surface: "Wall", moistureValue: 20, takenAt: day(1), roomId: null });
    const series = groupBySurface([a, b], day(2));
    expect(series).toHaveLength(2);
  });

  it("surfaces the dry-goal value when one reading is flagged", () => {
    const series = groupBySurface(
      [
        r({ surface: "DW", moistureValue: 40, takenAt: day(1), isInitial: true }),
        r({ surface: "DW", moistureValue: 16, takenAt: day(1), isDryGoal: true }),
        r({ surface: "DW", moistureValue: 30, takenAt: day(2) }),
        r({ surface: "DW", moistureValue: 22, takenAt: day(3) }),
        r({ surface: "DW", moistureValue: 15, takenAt: day(4) }),
      ],
      day(5),
    );
    const s = series[0];
    expect(s.dryGoalValue).toBe(16);
    expect(s.reachedGoal).toBe(true);
  });
});

describe("days-without-progress", () => {
  it("0 days when the most recent reading is the lowest", () => {
    const series = groupBySurface(
      [
        r({ surface: "DW", moistureValue: 40, takenAt: day(1) }),
        r({ surface: "DW", moistureValue: 25, takenAt: day(3) }),
        r({ surface: "DW", moistureValue: 20, takenAt: day(5) }),
      ],
      day(5),
    );
    expect(series[0].daysWithoutProgress).toBe(0);
    expect(series[0].stuck).toBe(false);
  });

  it("counts days since the lowest reading was taken", () => {
    // Lowest reading day(2). 'now' = day(8). 6 days without progress.
    const series = groupBySurface(
      [
        r({ surface: "DW", moistureValue: 40, takenAt: day(1) }),
        r({ surface: "DW", moistureValue: 22, takenAt: day(2) }),
        r({ surface: "DW", moistureValue: 24, takenAt: day(4) }),
        r({ surface: "DW", moistureValue: 25, takenAt: day(6) }),
      ],
      day(8),
    );
    expect(series[0].daysWithoutProgress).toBe(6);
  });

  it("flags a surface stuck once daysWithoutProgress exceeds the threshold (PRD §8.4)", () => {
    expect(STUCK_DAY_THRESHOLD).toBe(5);
    const series = groupBySurface(
      [
        r({ surface: "DW", moistureValue: 40, takenAt: day(1), isInitial: true }),
        r({ surface: "DW", moistureValue: 16, takenAt: day(1), isDryGoal: true }),
        r({ surface: "DW", moistureValue: 22, takenAt: day(2) }),
        r({ surface: "DW", moistureValue: 23, takenAt: day(4) }),
        r({ surface: "DW", moistureValue: 25, takenAt: day(7) }),
      ],
      day(8),
    );
    expect(series[0].daysWithoutProgress).toBe(6);
    expect(series[0].stuck).toBe(true);
  });

  it("a surface that hit the goal is never marked stuck", () => {
    const series = groupBySurface(
      [
        r({ surface: "DW", moistureValue: 40, takenAt: day(1) }),
        r({ surface: "DW", moistureValue: 16, takenAt: day(1), isDryGoal: true }),
        r({ surface: "DW", moistureValue: 14, takenAt: day(3) }),
      ],
      day(15),
    );
    expect(series[0].reachedGoal).toBe(true);
    expect(series[0].stuck).toBe(false);
  });
});

describe("stuckSurfaces", () => {
  it("filters to just the stuck ones", () => {
    const series = groupBySurface(
      [
        r({ surface: "Stuck", moistureValue: 40, takenAt: day(1) }),
        r({ surface: "Stuck", moistureValue: 16, takenAt: day(1), isDryGoal: true }),
        r({ surface: "Stuck", moistureValue: 25, takenAt: day(2) }),
        r({ surface: "Improving", moistureValue: 40, takenAt: day(1) }),
        r({ surface: "Improving", moistureValue: 12, takenAt: day(8) }),
      ],
      day(10),
    );
    const stuck = stuckSurfaces(series);
    expect(stuck.map((s) => s.surface)).toEqual(["Stuck"]);
  });
});

describe("distinctDayCount", () => {
  it("counts unique calendar days", () => {
    expect(
      distinctDayCount([
        r({ surface: "x", moistureValue: 1, takenAt: day(1) }),
        r({ surface: "x", moistureValue: 1, takenAt: day(1) }),
        r({ surface: "x", moistureValue: 1, takenAt: day(2) }),
        r({ surface: "x", moistureValue: 1, takenAt: day(3) }),
      ]),
    ).toBe(3);
  });
});
