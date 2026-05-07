import { describe, expect, it } from "vitest";
import {
  dailyEquipmentCounts,
  equipmentCsvHeader,
  parseEquipmentCsv,
  type PlacementForCount,
} from "./equipment";

const day = (n: number, h = 12) => new Date(Date.UTC(2026, 0, n, h));

describe("dailyEquipmentCounts", () => {
  it("counts an item on every day its placement window overlaps", () => {
    const placements: PlacementForCount[] = [
      // air mover #1: placed day 1 14:00, removed day 3 10:00 → on days 1, 2, 3
      {
        equipmentId: "am-1",
        type: "AIR_MOVER",
        placedAt: day(1, 14),
        removedAt: day(3, 10),
      },
    ];
    const rows = dailyEquipmentCounts(placements, day(1), day(4));
    expect(rows.map((r) => r.total)).toEqual([1, 1, 1, 0]);
  });

  it("DoD scenario: 5 air movers placed day 1, 2 removed day 2 morning", () => {
    const placements: PlacementForCount[] = [
      ...Array.from({ length: 3 }, (_, i) => ({
        equipmentId: `am-${i + 1}`,
        type: "AIR_MOVER" as const,
        placedAt: day(1, 9),
        removedAt: null,
      })),
      // these two are removed early on day 2
      {
        equipmentId: "am-4",
        type: "AIR_MOVER" as const,
        placedAt: day(1, 9),
        removedAt: day(2, 8),
      },
      {
        equipmentId: "am-5",
        type: "AIR_MOVER" as const,
        placedAt: day(1, 9),
        removedAt: day(2, 8),
      },
    ];
    const rows = dailyEquipmentCounts(placements, day(1), day(3));
    // Day 1: all 5 deployed. Day 2: all 5 deployed (the two removed at
    // 08:00 still overlap day 2). Day 3: 3.
    expect(rows[0].total).toBe(5);
    expect(rows[1].total).toBe(5);
    expect(rows[2].total).toBe(3);
    expect(rows[0].byType.AIR_MOVER).toBe(5);
  });

  it("counts mixed types separately", () => {
    const placements: PlacementForCount[] = [
      {
        equipmentId: "am-1",
        type: "AIR_MOVER",
        placedAt: day(1, 9),
        removedAt: null,
      },
      {
        equipmentId: "am-2",
        type: "AIR_MOVER",
        placedAt: day(1, 9),
        removedAt: null,
      },
      {
        equipmentId: "dh-1",
        type: "DEHUMIDIFIER_LGR",
        placedAt: day(1, 9),
        removedAt: null,
      },
    ];
    const rows = dailyEquipmentCounts(placements, day(1), day(1));
    expect(rows[0].total).toBe(3);
    expect(rows[0].byType.AIR_MOVER).toBe(2);
    expect(rows[0].byType.DEHUMIDIFIER_LGR).toBe(1);
  });

  it("does not double-count the same equipmentId across multiple placements", () => {
    // The same physical air mover is moved between rooms within a job —
    // two placement rows but only one device on a given day.
    const placements: PlacementForCount[] = [
      {
        equipmentId: "am-1",
        type: "AIR_MOVER",
        placedAt: day(1, 9),
        removedAt: day(1, 14),
      },
      {
        equipmentId: "am-1",
        type: "AIR_MOVER",
        placedAt: day(1, 14),
        removedAt: day(2, 9),
      },
    ];
    const rows = dailyEquipmentCounts(placements, day(1), day(1));
    expect(rows[0].total).toBe(1);
  });

  it("skips a placement that hasn't started yet", () => {
    const placements: PlacementForCount[] = [
      {
        equipmentId: "am-1",
        type: "AIR_MOVER",
        placedAt: day(5),
        removedAt: null,
      },
    ];
    const rows = dailyEquipmentCounts(placements, day(1), day(3));
    expect(rows.every((r) => r.total === 0)).toBe(true);
  });
});

describe("parseEquipmentCsv", () => {
  it("parses the canonical header + a row", () => {
    const csv = `${equipmentCsvHeader.join(",")}
AM-100,AIR_MOVER,Phoenix,Axial,SN-1,1.5,2900,,AVAILABLE,`;
    const r = parseEquipmentCsv(csv);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]).toMatchObject({
      assetTag: "AM-100",
      type: "AIR_MOVER",
      manufacturer: "Phoenix",
      model: "Axial",
      serialNumber: "SN-1",
      amperage: 1.5,
      cfm: 2900,
      ppd: null,
      status: "AVAILABLE",
      notes: null,
    });
  });

  it("rejects unknown types", () => {
    const csv = `assetTag,type
WIDGET-1,LASER_BLASTER`;
    const r = parseEquipmentCsv(csv);
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].message).toMatch(/Unknown type/);
  });

  it("flags duplicate asset tags within the same import", () => {
    const csv = `assetTag,type
AM-001,AIR_MOVER
AM-001,AIR_MOVER`;
    const r = parseEquipmentCsv(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.errors[0].message).toMatch(/Duplicate assetTag/);
  });

  it("handles quoted fields with commas and double-quotes", () => {
    const csv = `assetTag,type,notes
AM-2,AIR_MOVER,"Phoenix Axial, refurb ""like new"""`;
    const r = parseEquipmentCsv(csv);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0].notes).toBe('Phoenix Axial, refurb "like new"');
  });

  it("complains about missing required columns", () => {
    const csv = `manufacturer
Phoenix`;
    const r = parseEquipmentCsv(csv);
    expect(r.errors.find((e) => /Missing required column/.test(e.message))).toBeTruthy();
  });

  it("defaults status to AVAILABLE when blank", () => {
    const csv = `assetTag,type
AM-3,AIR_MOVER`;
    const r = parseEquipmentCsv(csv);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0].status).toBe("AVAILABLE");
  });

  it("DoD: 30-row import parses cleanly", () => {
    const lines = [equipmentCsvHeader.join(",")];
    for (let i = 1; i <= 30; i++) {
      lines.push(
        `AM-${String(i).padStart(3, "0")},AIR_MOVER,Phoenix,Axial,SN-${i},1.5,2900,,AVAILABLE,`,
      );
    }
    const r = parseEquipmentCsv(lines.join("\n"));
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(30);
    expect(r.rows[0].assetTag).toBe("AM-001");
    expect(r.rows[29].assetTag).toBe("AM-030");
  });
});
