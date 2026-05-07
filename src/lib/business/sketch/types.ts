/**
 * SketchScene — the JSON blob persisted on `Sketch.sceneData` and shared
 * between the Konva-based client editor (`/app/jobs/[id]/sketches/[id]`)
 * and the server-side renderer (`/render/sketch/[id]`).
 *
 * Mirrors PRD §8.3 with two pragmatic v1 simplifications noted inline.
 *
 * Coordinate system: stage units are PIXELS at the scene's `pixelsPerFoot`
 * scale. So a wall whose two endpoints are 10 px apart at 10 px/ft = 1 ft.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  /** Endpoints in stage pixels: [x1, y1, x2, y2]. PRD says `points: number[]`. */
  points: [number, number, number, number];
  /** Wall thickness in pixels (visual only; PRD says `thickness`). */
  thickness: number;
}

export interface Room {
  id: string;
  name: string;
  /** Closed polygon — IDs of the walls that enclose this room. */
  wallIds: string[];
  /** v1: cached so we don't recompute on every render. Recomputed on save. */
  cachedSqFt?: number;
  cachedLinearFt?: number;
  /** Centroid where the label is rendered. Recomputed on save. */
  cachedCentroid?: Point;
  ceilingHeightFt: number;
  materials?: { floor?: string; walls?: string; ceiling?: string };
}

export interface Door {
  id: string;
  /** Wall this door is anchored to. */
  wallId: string;
  /** Position along the wall, 0 = wall start, 1 = wall end. */
  positionAlongWall: number;
  widthIn: number;
  swing: "left" | "right";
}

export interface Window {
  id: string;
  wallId: string;
  positionAlongWall: number;
  widthIn: number;
  heightIn: number;
  sillHeightIn: number;
}

/**
 * v1 simplification: Stairs and Openings (cased openings without a door)
 * are just `Label` annotations. Phase 6 ships Wall/Door/Window/Label/
 * Dimension. Adding distinct Stair/Opening primitives is a v2 concern.
 */
export interface Label {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

export interface Dimension {
  id: string;
  from: [number, number];
  to: [number, number];
  /** Pixel offset perpendicular to the line for the dimension text. */
  offset: number;
}

export interface Floor {
  id: string;
  name: string;
  walls: Wall[];
  rooms: Room[];
  doors: Door[];
  windows: Window[];
  labels: Label[];
  dimensions: Dimension[];
}

export interface SketchScene {
  /** Schema version. Bump when introducing a backwards-incompatible change. */
  schemaVersion: 1;
  floors: Floor[];
  /** ID of the floor currently shown in the editor; saved between sessions. */
  activeFloorId: string;
  scale: { pixelsPerFoot: number };
  units: "imperial" | "metric";
}

export const DEFAULT_PIXELS_PER_FOOT = 10;
export const DEFAULT_GRID_INCHES = 6; // 6" grid (PRD §8.3)
export const DEFAULT_DOOR_WIDTH_IN = 32;
export const DEFAULT_WINDOW_WIDTH_IN = 36;
export const DEFAULT_WINDOW_HEIGHT_IN = 48;
export const DEFAULT_WINDOW_SILL_IN = 36;
export const DEFAULT_CEILING_FT = 8;
export const SNAP_PIXELS = 12; // PRD §8.3 — snap to existing endpoints
