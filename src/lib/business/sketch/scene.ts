import { z } from "zod";
import {
  DEFAULT_CEILING_FT,
  DEFAULT_PIXELS_PER_FOOT,
  type Floor,
  type SketchScene,
} from "./types";
import {
  polygonAreaSqFt,
  polygonCentroid,
  polygonForWalls,
  polygonPerimeterFt,
} from "./geometry";

// ---------------------------------------------------------------------------
// Zod schema for runtime validation when the client sends a scene to save.
// We're permissive on `cached*` since the server recomputes them.
// ---------------------------------------------------------------------------

const pointPair = z.tuple([z.number(), z.number()]);

const wallSchema = z.object({
  id: z.string().min(1).max(40),
  points: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  thickness: z.number().nonnegative().max(40).default(4),
});

const roomSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().max(80).default(""),
  wallIds: z.array(z.string().min(1)).max(64).default([]),
  cachedSqFt: z.number().nonnegative().optional(),
  cachedLinearFt: z.number().nonnegative().optional(),
  cachedCentroid: z.object({ x: z.number(), y: z.number() }).optional(),
  ceilingHeightFt: z.number().positive().max(40).default(DEFAULT_CEILING_FT),
  materials: z
    .object({
      floor: z.string().optional(),
      walls: z.string().optional(),
      ceiling: z.string().optional(),
    })
    .optional(),
});

const doorSchema = z.object({
  id: z.string().min(1).max(40),
  wallId: z.string().min(1),
  positionAlongWall: z.number().min(0).max(1),
  widthIn: z.number().positive().max(120).default(32),
  swing: z.enum(["left", "right"]).default("left"),
});

const windowSchema = z.object({
  id: z.string().min(1).max(40),
  wallId: z.string().min(1),
  positionAlongWall: z.number().min(0).max(1),
  widthIn: z.number().positive().max(180).default(36),
  heightIn: z.number().positive().max(120).default(48),
  sillHeightIn: z.number().nonnegative().max(120).default(36),
});

const labelSchema = z.object({
  id: z.string().min(1).max(40),
  x: z.number(),
  y: z.number(),
  text: z.string().max(120).default(""),
  fontSize: z.number().positive().max(96).default(12),
});

const dimensionSchema = z.object({
  id: z.string().min(1).max(40),
  from: pointPair,
  to: pointPair,
  offset: z.number().default(20),
});

const floorSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().max(40),
  walls: z.array(wallSchema).max(500).default([]),
  rooms: z.array(roomSchema).max(50).default([]),
  doors: z.array(doorSchema).max(200).default([]),
  windows: z.array(windowSchema).max(200).default([]),
  labels: z.array(labelSchema).max(200).default([]),
  dimensions: z.array(dimensionSchema).max(200).default([]),
});

export const sketchSceneSchema = z.object({
  schemaVersion: z.literal(1),
  floors: z.array(floorSchema).min(1).max(8),
  activeFloorId: z.string().min(1),
  scale: z.object({
    pixelsPerFoot: z.number().positive().max(200).default(DEFAULT_PIXELS_PER_FOOT),
  }),
  units: z.enum(["imperial", "metric"]).default("imperial"),
});

export function parseScene(value: unknown): SketchScene {
  return sketchSceneSchema.parse(value) as SketchScene;
}

// ---------------------------------------------------------------------------
// New-scene factory
// ---------------------------------------------------------------------------

export function newScene(): SketchScene {
  const id = randomId();
  return {
    schemaVersion: 1,
    activeFloorId: id,
    floors: [
      {
        id,
        name: "Floor 1",
        walls: [],
        rooms: [],
        doors: [],
        windows: [],
        labels: [],
        dimensions: [],
      },
    ],
    scale: { pixelsPerFoot: DEFAULT_PIXELS_PER_FOOT },
    units: "imperial",
  };
}

export function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// Recompute room cached areas/perimeters/centroids server-side. Called on
// save so the renderer + UI always see consistent values regardless of
// client drift.
// ---------------------------------------------------------------------------

export function recomputeRooms(
  floor: Floor,
  pxPerFt: number,
): Floor {
  const rooms = floor.rooms.map((r) => {
    const poly = polygonForWalls(r.wallIds, floor.walls);
    if (!poly) {
      return {
        ...r,
        cachedSqFt: undefined,
        cachedLinearFt: undefined,
        cachedCentroid: undefined,
      };
    }
    return {
      ...r,
      cachedSqFt: Math.round(polygonAreaSqFt(poly, pxPerFt) * 10) / 10,
      cachedLinearFt: Math.round(polygonPerimeterFt(poly, pxPerFt) * 10) / 10,
      cachedCentroid: polygonCentroid(poly),
    };
  });
  return { ...floor, rooms };
}

/** Sum sqft / linear feet across all closed rooms across all floors. */
export function totalAreas(scene: SketchScene): {
  totalSqFt: number;
  totalLinearFt: number;
} {
  let totalSqFt = 0;
  let totalLinearFt = 0;
  for (const f of scene.floors) {
    for (const r of f.rooms) {
      if (r.cachedSqFt) totalSqFt += r.cachedSqFt;
      if (r.cachedLinearFt) totalLinearFt += r.cachedLinearFt;
    }
  }
  return {
    totalSqFt: Math.round(totalSqFt * 10) / 10,
    totalLinearFt: Math.round(totalLinearFt * 10) / 10,
  };
}

export function normaliseAndRecompute(scene: SketchScene): SketchScene {
  return {
    ...scene,
    floors: scene.floors.map((f) =>
      recomputeRooms(f, scene.scale.pixelsPerFoot),
    ),
  };
}
