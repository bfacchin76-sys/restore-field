/**
 * Geometry helpers for the sketch editor + renderer.
 *
 * All distances are in PIXELS unless an explicit `pxPerFt` arg is taken.
 * Conversion to feet/inches happens at the boundary so the editor never
 * has to think about the scale factor.
 */

import type { Point, Wall, Floor } from "./types";
import { SNAP_PIXELS } from "./types";

// =============================================================================
// Snap
// =============================================================================

/**
 * Snap a free point to the grid (in pixels). 6"/0.5 ft is the default grid;
 * the caller passes `gridPx = 0.5 * pxPerFt`.
 */
export function snapToGrid(p: Point, gridPx: number): Point {
  if (gridPx <= 0) return p;
  return {
    x: Math.round(p.x / gridPx) * gridPx,
    y: Math.round(p.y / gridPx) * gridPx,
  };
}

/**
 * Snap to the nearest existing wall endpoint within `SNAP_PIXELS` pixels.
 * Returns the snapped point or `null` if nothing in range. Used by the
 * Wall tool so polylines reliably close into rooms.
 */
export function snapToEndpoint(
  p: Point,
  walls: readonly Wall[],
  toleranceInPx: number = SNAP_PIXELS,
): Point | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (const w of walls) {
    const ends: Point[] = [
      { x: w.points[0], y: w.points[1] },
      { x: w.points[2], y: w.points[3] },
    ];
    for (const e of ends) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d <= toleranceInPx && d < bestD) {
        bestD = d;
        best = e;
      }
    }
  }
  return best;
}

// =============================================================================
// Wall geometry
// =============================================================================

export function wallLengthPx(w: Wall): number {
  const [x1, y1, x2, y2] = w.points;
  return Math.hypot(x2 - x1, y2 - y1);
}

export function pointAt(
  w: Wall,
  fraction: number,
): Point {
  const [x1, y1, x2, y2] = w.points;
  const t = clamp01(fraction);
  return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
}

export function wallAngleRadians(w: Wall): number {
  const [x1, y1, x2, y2] = w.points;
  return Math.atan2(y2 - y1, x2 - x1);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// =============================================================================
// Polygon + room detection
// =============================================================================

/**
 * Walk a closed polygon out of the given wall ids, returning the ordered
 * vertices in stage-pixel space. Returns null if the wall set isn't closed
 * (each vertex must appear in exactly two walls).
 *
 * The walk picks a starting wall and traces neighbours by shared endpoint
 * coordinates with `EPS` tolerance.
 */
const EPS = 1.5;

function endpointsOf(w: Wall): [Point, Point] {
  return [
    { x: w.points[0], y: w.points[1] },
    { x: w.points[2], y: w.points[3] },
  ];
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}

export function polygonForWalls(
  wallIds: readonly string[],
  walls: readonly Wall[],
): Point[] | null {
  if (wallIds.length < 3) return null;
  const byId = new Map(walls.map((w) => [w.id, w] as const));
  const wallList = wallIds
    .map((id) => byId.get(id))
    .filter((w): w is Wall => !!w);
  if (wallList.length !== wallIds.length) return null;

  // Walk
  const remaining = new Set(wallList.map((w) => w.id));
  const first = wallList[0];
  remaining.delete(first.id);
  const verts: Point[] = [];
  const [start, end] = endpointsOf(first);
  verts.push(start, end);
  let current: Point = end;

  while (remaining.size > 0) {
    let nextId: string | null = null;
    let nextEnd: Point | null = null;
    for (const id of remaining) {
      const w = byId.get(id)!;
      const [a, b] = endpointsOf(w);
      if (samePoint(a, current)) {
        nextId = id;
        nextEnd = b;
        break;
      }
      if (samePoint(b, current)) {
        nextId = id;
        nextEnd = a;
        break;
      }
    }
    if (!nextId || !nextEnd) return null;
    remaining.delete(nextId);
    verts.push(nextEnd);
    current = nextEnd;
  }

  // Last point must close back to start
  if (!samePoint(current, start)) return null;
  // Drop the duplicate closing vertex
  verts.pop();
  return verts;
}

/** Shoelace area, signed. Positive = counter-clockwise in screen coords. */
function signedAreaPx(poly: Point[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonAreaSqFt(poly: Point[], pxPerFt: number): number {
  if (poly.length < 3 || pxPerFt <= 0) return 0;
  const areaPx = Math.abs(signedAreaPx(poly));
  return areaPx / (pxPerFt * pxPerFt);
}

export function polygonPerimeterFt(poly: Point[], pxPerFt: number): number {
  if (poly.length < 2 || pxPerFt <= 0) return 0;
  let perim = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    perim += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return perim / pxPerFt;
}

export function polygonCentroid(poly: Point[]): Point {
  if (poly.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / poly.length, y: sy / poly.length };
}

// =============================================================================
// Bounding box (used by exporter to scale viewBox)
// =============================================================================

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function floorBoundingBox(floor: Floor): BBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const w of floor.walls) {
    const [x1, y1, x2, y2] = w.points;
    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
    if (x2 < minX) minX = x2;
    if (y2 < minY) minY = y2;
    any = true;
  }
  for (const l of floor.labels) {
    if (l.x < minX) minX = l.x;
    if (l.y < minY) minY = l.y;
    if (l.x > maxX) maxX = l.x;
    if (l.y > maxY) maxY = l.y;
    any = true;
  }
  if (!any) return null;
  return { minX, minY, maxX, maxY };
}
