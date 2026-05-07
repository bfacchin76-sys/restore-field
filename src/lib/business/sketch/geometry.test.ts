import { describe, expect, it } from "vitest";
import {
  floorBoundingBox,
  polygonAreaSqFt,
  polygonCentroid,
  polygonForWalls,
  polygonPerimeterFt,
  snapToEndpoint,
  snapToGrid,
  wallLengthPx,
} from "./geometry";
import type { Floor, Wall } from "./types";

const wall = (id: string, x1: number, y1: number, x2: number, y2: number): Wall => ({
  id,
  points: [x1, y1, x2, y2],
  thickness: 4,
});

describe("snapToGrid", () => {
  it("rounds to the nearest grid cell", () => {
    expect(snapToGrid({ x: 12, y: 22 }, 5)).toEqual({ x: 10, y: 20 });
    expect(snapToGrid({ x: 13, y: 22 }, 5)).toEqual({ x: 15, y: 20 });
  });
  it("is a no-op when grid <= 0", () => {
    expect(snapToGrid({ x: 12.3, y: 4.5 }, 0)).toEqual({ x: 12.3, y: 4.5 });
  });
});

describe("snapToEndpoint", () => {
  const walls = [
    wall("w1", 0, 0, 100, 0),
    wall("w2", 100, 0, 100, 80),
  ];
  it("snaps to a wall endpoint within tolerance", () => {
    expect(snapToEndpoint({ x: 5, y: 4 }, walls, 12)).toEqual({ x: 0, y: 0 });
    expect(snapToEndpoint({ x: 95, y: 5 }, walls, 12)).toEqual({ x: 100, y: 0 });
  });
  it("returns null when no endpoint is within tolerance", () => {
    expect(snapToEndpoint({ x: 200, y: 200 }, walls, 12)).toBeNull();
  });
  it("picks the nearest endpoint when multiple are in range", () => {
    expect(snapToEndpoint({ x: 99, y: 1 }, walls, 12)).toEqual({ x: 100, y: 0 });
  });
});

describe("wallLengthPx", () => {
  it("returns euclidean length", () => {
    expect(wallLengthPx(wall("w", 0, 0, 30, 40))).toBe(50);
  });
});

describe("polygonForWalls", () => {
  it("walks a 4-wall closed rectangle", () => {
    const walls = [
      wall("a", 0, 0, 100, 0),
      wall("b", 100, 0, 100, 80),
      wall("c", 100, 80, 0, 80),
      wall("d", 0, 80, 0, 0),
    ];
    const poly = polygonForWalls(["a", "b", "c", "d"], walls);
    expect(poly).not.toBeNull();
    expect(poly!.length).toBe(4);
  });

  it("works regardless of starting wall direction", () => {
    // Same rectangle but with a wall "reversed"
    const walls = [
      wall("a", 0, 0, 100, 0),
      wall("b", 100, 80, 100, 0), // reversed
      wall("c", 100, 80, 0, 80),
      wall("d", 0, 80, 0, 0),
    ];
    const poly = polygonForWalls(["a", "b", "c", "d"], walls);
    expect(poly).not.toBeNull();
    expect(poly!.length).toBe(4);
  });

  it("returns null when the polygon doesn't close", () => {
    const walls = [
      wall("a", 0, 0, 100, 0),
      wall("b", 100, 0, 100, 80),
      wall("c", 100, 80, 50, 80),
      // missing wall back to (0,0)
    ];
    expect(polygonForWalls(["a", "b", "c"], walls)).toBeNull();
  });
});

describe("polygonAreaSqFt + polygonPerimeterFt", () => {
  // 14ft × 12ft room at 10 px/ft = 140×120 px
  const ppf = 10;
  const rect = [
    { x: 0, y: 0 },
    { x: 140, y: 0 },
    { x: 140, y: 120 },
    { x: 0, y: 120 },
  ];

  it("computes the area in sqft", () => {
    expect(polygonAreaSqFt(rect, ppf)).toBe(168);
  });
  it("computes the perimeter in linear feet", () => {
    expect(polygonPerimeterFt(rect, ppf)).toBe(52);
  });
  it("returns 0 for degenerate inputs", () => {
    expect(polygonAreaSqFt([], ppf)).toBe(0);
    expect(polygonPerimeterFt([{ x: 0, y: 0 }], ppf)).toBe(0);
    expect(polygonAreaSqFt(rect, 0)).toBe(0);
  });
});

describe("polygonCentroid", () => {
  it("averages the vertices", () => {
    expect(
      polygonCentroid([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ]),
    ).toEqual({ x: 50, y: 50 });
  });
});

describe("floorBoundingBox", () => {
  it("encloses every wall endpoint and label", () => {
    const floor: Floor = {
      id: "f",
      name: "F1",
      walls: [
        wall("a", 10, 5, 50, 30),
        wall("b", 50, 30, 50, 80),
      ],
      rooms: [],
      doors: [],
      windows: [],
      labels: [{ id: "l", x: -5, y: 100, text: "n", fontSize: 12 }],
      dimensions: [],
    };
    const bb = floorBoundingBox(floor)!;
    expect(bb.minX).toBe(-5);
    expect(bb.minY).toBe(5);
    expect(bb.maxX).toBe(50);
    expect(bb.maxY).toBe(100);
  });
  it("returns null for an empty floor", () => {
    expect(
      floorBoundingBox({
        id: "f",
        name: "F1",
        walls: [],
        rooms: [],
        doors: [],
        windows: [],
        labels: [],
        dimensions: [],
      }),
    ).toBeNull();
  });
});
