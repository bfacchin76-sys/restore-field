/**
 * Server-side SVG renderer for a SketchScene's active floor.
 *
 * The renderer is plain string-builder SVG, not Konva — that lets us run
 * it from any context (worker, route handler, Puppeteer wrapper) without
 * needing a DOM. The visual output mirrors the editor: walls, doors,
 * windows, room name + area + perimeter labels, dimension annotations.
 *
 * Output is sized so the floor is centered with a margin, which matters
 * for Xactimate underlay imports — measurements stay legible at 1× and 2×
 * DPI raster exports.
 */

import { floorBoundingBox, polygonForWalls, wallAngleRadians, wallLengthPx } from "./geometry";
import type { Floor, SketchScene } from "./types";

interface RenderOpts {
  /** Final raster width in pixels (height auto-derived from floor aspect). */
  pageWidthPx?: number;
  pageHeightPx?: number;
  /** Margin around content in pixels. */
  marginPx?: number;
  /** Title shown top-left. */
  title?: string;
  /** Footer / project info shown bottom-left. */
  footer?: string;
  /** Whether to render the dot grid. */
  showGrid?: boolean;
}

const DEFAULT_OPTS: Required<RenderOpts> = {
  pageWidthPx: 1100,
  pageHeightPx: 850,
  marginPx: 60,
  title: "",
  footer: "",
  showGrid: true,
};

const GRID_STEP_FT = 1; // dot grid every 1 ft
const SCALE_BAR_FT = 5;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Produce an SVG document for the given scene's active floor. The
 * viewBox is sized so 1 user-unit = 1 stage-pixel — we apply a uniform
 * scale via `transform` to fit the page.
 */
export function renderSceneSvg(scene: SketchScene, opts?: RenderOpts): string {
  const o = { ...DEFAULT_OPTS, ...opts };
  const floor =
    scene.floors.find((f) => f.id === scene.activeFloorId) ?? scene.floors[0];
  if (!floor) {
    return emptySvg(o, "No floors yet");
  }
  const bb = floorBoundingBox(floor);
  if (!bb) {
    return emptySvg(o, "Empty floor — draw walls to begin");
  }

  const contentW = Math.max(1, bb.maxX - bb.minX);
  const contentH = Math.max(1, bb.maxY - bb.minY);
  const availW = o.pageWidthPx - 2 * o.marginPx;
  const availH = o.pageHeightPx - 2 * o.marginPx;
  const scale = Math.min(availW / contentW, availH / contentH);
  const tx = o.marginPx + (availW - contentW * scale) / 2 - bb.minX * scale;
  const ty = o.marginPx + (availH - contentH * scale) / 2 - bb.minY * scale;

  const transform = `translate(${tx}, ${ty}) scale(${scale})`;
  const pxPerFt = scene.scale.pixelsPerFoot;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${o.pageWidthPx}" height="${o.pageHeightPx}" viewBox="0 0 ${o.pageWidthPx} ${o.pageHeightPx}" font-family="ui-sans-serif, system-ui, sans-serif">`,
  );
  // White background
  parts.push(
    `<rect width="${o.pageWidthPx}" height="${o.pageHeightPx}" fill="#ffffff"/>`,
  );

  // Title bar
  if (o.title) {
    parts.push(
      `<text x="${o.marginPx}" y="${o.marginPx - 24}" font-size="18" fill="#1e3a8a" font-weight="600">${esc(o.title)}</text>`,
    );
  }

  // Optional grid (in floor coords, transformed)
  if (o.showGrid) {
    const gridStepPx = GRID_STEP_FT * pxPerFt;
    const x0 = Math.floor(bb.minX / gridStepPx) * gridStepPx;
    const y0 = Math.floor(bb.minY / gridStepPx) * gridStepPx;
    const x1 = Math.ceil(bb.maxX / gridStepPx) * gridStepPx;
    const y1 = Math.ceil(bb.maxY / gridStepPx) * gridStepPx;
    parts.push(`<g transform="${transform}" stroke="#e2e8f0" stroke-width="${0.5 / scale}">`);
    for (let x = x0; x <= x1; x += gridStepPx) {
      for (let y = y0; y <= y1; y += gridStepPx) {
        parts.push(`<circle cx="${x}" cy="${y}" r="${1.4 / scale}" fill="#cbd5e1"/>`);
      }
    }
    parts.push("</g>");
  }

  // Floor content
  parts.push(`<g transform="${transform}">`);

  // Room polygon fills (only for closed rooms)
  for (const room of floor.rooms) {
    const poly = polygonForWalls(room.wallIds, floor.walls);
    if (!poly || poly.length < 3) continue;
    const pts = poly.map((p) => `${p.x},${p.y}`).join(" ");
    parts.push(
      `<polygon points="${pts}" fill="rgba(30, 58, 138, 0.06)" stroke="none"/>`,
    );
  }

  // Walls
  for (const w of floor.walls) {
    const [x1, y1, x2, y2] = w.points;
    const t = Math.max(2, w.thickness);
    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0f172a" stroke-width="${t}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    // Wall length label
    const lenFt = wallLengthPx(w) / pxPerFt;
    if (lenFt >= 0.5) {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      parts.push(
        `<text x="${cx}" y="${cy - t - 4}" font-size="${10 / scale}" fill="#475569" text-anchor="middle">${formatFeetInches(lenFt)}</text>`,
      );
    }
  }

  // Doors — drawn as a 2"-wide gap on the wall + a swing arc
  for (const d of floor.doors) {
    const wall = floor.walls.find((w) => w.id === d.wallId);
    if (!wall) continue;
    const [x1, y1, x2, y2] = wall.points;
    const cx = x1 + (x2 - x1) * d.positionAlongWall;
    const cy = y1 + (y2 - y1) * d.positionAlongWall;
    const angle = wallAngleRadians(wall);
    const widthPx = (d.widthIn / 12) * pxPerFt;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const ax = cx - dx * widthPx / 2;
    const ay = cy - dy * widthPx / 2;
    const bx = cx + dx * widthPx / 2;
    const by = cy + dy * widthPx / 2;
    // Erase wall under door + draw door jamb
    parts.push(
      `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#ffffff" stroke-width="${wall.thickness + 2}" stroke-linecap="butt"/>`,
    );
    parts.push(
      `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#0f172a" stroke-width="1"/>`,
    );
    // Swing arc (90° on the chosen side)
    const sign = d.swing === "right" ? 1 : -1;
    const nx = -dy * sign;
    const ny = dx * sign;
    const ex = ax + nx * widthPx;
    const ey = ay + ny * widthPx;
    parts.push(
      `<path d="M ${ax} ${ay} L ${ex} ${ey} A ${widthPx} ${widthPx} 0 0 ${d.swing === "right" ? 1 : 0} ${bx} ${by}" fill="none" stroke="#94a3b8" stroke-width="0.6" stroke-dasharray="3,3"/>`,
    );
  }

  // Windows — double line on the wall
  for (const win of floor.windows) {
    const wall = floor.walls.find((w) => w.id === win.wallId);
    if (!wall) continue;
    const [x1, y1, x2, y2] = wall.points;
    const cx = x1 + (x2 - x1) * win.positionAlongWall;
    const cy = y1 + (y2 - y1) * win.positionAlongWall;
    const angle = wallAngleRadians(wall);
    const widthPx = (win.widthIn / 12) * pxPerFt;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const ax = cx - dx * widthPx / 2;
    const ay = cy - dy * widthPx / 2;
    const bx = cx + dx * widthPx / 2;
    const by = cy + dy * widthPx / 2;
    const nx = -dy;
    const ny = dx;
    const off = wall.thickness * 0.6;
    parts.push(
      `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#ffffff" stroke-width="${wall.thickness + 2}"/>`,
    );
    parts.push(
      `<line x1="${ax + nx * off}" y1="${ay + ny * off}" x2="${bx + nx * off}" y2="${by + ny * off}" stroke="#0f172a" stroke-width="1"/>`,
    );
    parts.push(
      `<line x1="${ax - nx * off}" y1="${ay - ny * off}" x2="${bx - nx * off}" y2="${by - ny * off}" stroke="#0f172a" stroke-width="1"/>`,
    );
  }

  // Room labels
  for (const room of floor.rooms) {
    const c = room.cachedCentroid;
    if (!c) continue;
    const fontSize = 12 / scale;
    parts.push(
      `<text x="${c.x}" y="${c.y - fontSize}" font-size="${fontSize}" font-weight="600" fill="#1e293b" text-anchor="middle">${esc(room.name || "Room")}</text>`,
    );
    if (room.cachedSqFt) {
      parts.push(
        `<text x="${c.x}" y="${c.y + fontSize * 0.6}" font-size="${fontSize * 0.85}" fill="#475569" text-anchor="middle">${room.cachedSqFt.toFixed(0)} sq ft · ${room.cachedLinearFt?.toFixed(0) ?? "?"} lf</text>`,
      );
    }
  }

  // User-placed labels
  for (const l of floor.labels) {
    parts.push(
      `<text x="${l.x}" y="${l.y}" font-size="${l.fontSize / scale}" fill="#0f172a">${esc(l.text)}</text>`,
    );
  }

  // Dimensions
  for (const dim of floor.dimensions) {
    const [x1, y1] = dim.from;
    const [x2, y2] = dim.to;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const nx = -dy / len;
    const ny = dx / len;
    const off = dim.offset;
    const ox1 = x1 + nx * off;
    const oy1 = y1 + ny * off;
    const ox2 = x2 + nx * off;
    const oy2 = y2 + ny * off;
    const lf = len / pxPerFt;
    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${ox1}" y2="${oy1}" stroke="#475569" stroke-width="${0.6 / scale}"/>`,
    );
    parts.push(
      `<line x1="${x2}" y1="${y2}" x2="${ox2}" y2="${oy2}" stroke="#475569" stroke-width="${0.6 / scale}"/>`,
    );
    parts.push(
      `<line x1="${ox1}" y1="${oy1}" x2="${ox2}" y2="${oy2}" stroke="#475569" stroke-width="${1 / scale}"/>`,
    );
    parts.push(
      `<text x="${(ox1 + ox2) / 2}" y="${(oy1 + oy2) / 2 - 4 / scale}" font-size="${10 / scale}" fill="#0f172a" text-anchor="middle">${formatFeetInches(lf)}</text>`,
    );
  }

  parts.push("</g>");

  // Scale bar (5 ft) bottom-right, in page coords
  const sbLenPx = SCALE_BAR_FT * pxPerFt * scale;
  const sbX = o.pageWidthPx - o.marginPx - sbLenPx;
  const sbY = o.pageHeightPx - o.marginPx + 18;
  parts.push(
    `<line x1="${sbX}" y1="${sbY}" x2="${sbX + sbLenPx}" y2="${sbY}" stroke="#0f172a" stroke-width="2"/>`,
  );
  parts.push(
    `<line x1="${sbX}" y1="${sbY - 5}" x2="${sbX}" y2="${sbY + 5}" stroke="#0f172a" stroke-width="2"/>`,
  );
  parts.push(
    `<line x1="${sbX + sbLenPx}" y1="${sbY - 5}" x2="${sbX + sbLenPx}" y2="${sbY + 5}" stroke="#0f172a" stroke-width="2"/>`,
  );
  parts.push(
    `<text x="${sbX + sbLenPx / 2}" y="${sbY + 18}" font-size="11" fill="#0f172a" text-anchor="middle">${SCALE_BAR_FT} ft</text>`,
  );

  // North arrow top-right
  const naX = o.pageWidthPx - o.marginPx - 20;
  const naY = o.marginPx + 10;
  parts.push(
    `<g transform="translate(${naX}, ${naY})" fill="#0f172a">
      <line x1="0" y1="0" x2="0" y2="-22" stroke="#0f172a" stroke-width="2"/>
      <polygon points="0,-30 -5,-18 5,-18"/>
      <text x="0" y="14" font-size="11" text-anchor="middle">N</text>
     </g>`,
  );

  // Footer
  if (o.footer) {
    parts.push(
      `<text x="${o.marginPx}" y="${o.pageHeightPx - 16}" font-size="10" fill="#475569">${esc(o.footer)}</text>`,
    );
  }

  parts.push("</svg>");
  return parts.join("");
}

function emptySvg(o: Required<RenderOpts>, message: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${o.pageWidthPx}" height="${o.pageHeightPx}" viewBox="0 0 ${o.pageWidthPx} ${o.pageHeightPx}">
    <rect width="${o.pageWidthPx}" height="${o.pageHeightPx}" fill="#ffffff"/>
    <text x="${o.pageWidthPx / 2}" y="${o.pageHeightPx / 2}" font-size="14" fill="#94a3b8" text-anchor="middle" font-family="ui-sans-serif, system-ui">${esc(message)}</text>
  </svg>`;
}

/** Format a length in feet as `12' 6"`. */
export function formatFeetInches(lengthFt: number): string {
  if (!Number.isFinite(lengthFt) || lengthFt < 0) return "0'";
  const totalIn = Math.round(lengthFt * 12);
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn % 12;
  if (inch === 0) return `${ft}'`;
  return `${ft}' ${inch}"`;
}

export function floorByActive(scene: SketchScene): Floor | null {
  return (
    scene.floors.find((f) => f.id === scene.activeFloorId) ??
    scene.floors[0] ??
    null
  );
}
