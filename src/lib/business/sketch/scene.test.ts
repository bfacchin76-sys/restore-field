import { describe, expect, it } from "vitest";
import {
  newScene,
  normaliseAndRecompute,
  parseScene,
  recomputeRooms,
  totalAreas,
} from "./scene";
import type { Floor } from "./types";

describe("newScene", () => {
  it("starts with one floor and a sane default scale", () => {
    const s = newScene();
    expect(s.floors).toHaveLength(1);
    expect(s.scale.pixelsPerFoot).toBe(10);
    expect(s.activeFloorId).toBe(s.floors[0].id);
    expect(s.units).toBe("imperial");
  });
});

describe("parseScene", () => {
  it("accepts a freshly minted scene", () => {
    expect(() => parseScene(newScene())).not.toThrow();
  });
  it("rejects schemaVersion drift", () => {
    expect(() =>
      parseScene({ ...newScene(), schemaVersion: 999 }),
    ).toThrow();
  });
});

describe("recomputeRooms", () => {
  it("fills in cachedSqFt / cachedLinearFt / cachedCentroid for closed rooms", () => {
    // 14ft × 12ft rectangle at 10 px/ft
    const floor: Floor = {
      id: "f",
      name: "F1",
      walls: [
        { id: "n", points: [0, 0, 140, 0], thickness: 4 },
        { id: "e", points: [140, 0, 140, 120], thickness: 4 },
        { id: "s", points: [140, 120, 0, 120], thickness: 4 },
        { id: "w", points: [0, 120, 0, 0], thickness: 4 },
      ],
      rooms: [
        {
          id: "r1",
          name: "Kitchen",
          wallIds: ["n", "e", "s", "w"],
          ceilingHeightFt: 8,
        },
      ],
      doors: [],
      windows: [],
      labels: [],
      dimensions: [],
    };
    const out = recomputeRooms(floor, 10);
    expect(out.rooms[0].cachedSqFt).toBe(168);
    expect(out.rooms[0].cachedLinearFt).toBe(52);
    expect(out.rooms[0].cachedCentroid).toEqual({ x: 70, y: 60 });
  });

  it("clears cache when a room's polygon doesn't close", () => {
    const floor: Floor = {
      id: "f",
      name: "F1",
      walls: [
        { id: "a", points: [0, 0, 100, 0], thickness: 4 },
        { id: "b", points: [100, 0, 100, 80], thickness: 4 },
      ],
      rooms: [
        {
          id: "r1",
          name: "Open",
          wallIds: ["a", "b"],
          ceilingHeightFt: 8,
          cachedSqFt: 999,
          cachedLinearFt: 999,
        },
      ],
      doors: [],
      windows: [],
      labels: [],
      dimensions: [],
    };
    const out = recomputeRooms(floor, 10);
    expect(out.rooms[0].cachedSqFt).toBeUndefined();
    expect(out.rooms[0].cachedLinearFt).toBeUndefined();
  });
});

describe("totalAreas", () => {
  it("sums every room's cachedSqFt across floors", () => {
    const s = newScene();
    s.floors[0] = {
      ...s.floors[0],
      walls: [
        { id: "n", points: [0, 0, 100, 0], thickness: 4 },
        { id: "e", points: [100, 0, 100, 100], thickness: 4 },
        { id: "s", points: [100, 100, 0, 100], thickness: 4 },
        { id: "w", points: [0, 100, 0, 0], thickness: 4 },
      ],
      rooms: [
        {
          id: "r",
          name: "x",
          wallIds: ["n", "e", "s", "w"],
          ceilingHeightFt: 8,
        },
      ],
    };
    const recomp = normaliseAndRecompute(s);
    const t = totalAreas(recomp);
    expect(t.totalSqFt).toBe(100); // 100×100 px ÷ (10 px/ft)² = 100 sqft
    expect(t.totalLinearFt).toBe(40);
  });
});
