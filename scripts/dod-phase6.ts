/**
 * Phase 6 DoD walkthrough.
 *
 *  1. Build a SketchScene programmatically: 4 rooms (Kitchen, Living,
 *     Hall, Bedroom) on Floor 1, walls + doors + windows + labels +
 *     dimensions.
 *  2. Persist it via prisma.sketch.create.
 *  3. Render PNG @ 1× and 2× via the same SVG pipeline the API route uses;
 *     verify dimensions, file size > 0, and that 2× has more pixels.
 *  4. Render PDF via Puppeteer; verify the file is a valid %PDF.
 *  5. Re-parse the saved scene to confirm round-trip stability.
 */

import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const Module = req("module") as {
  _cache: Record<string, unknown>;
  _resolveFilename: (s: string, p: unknown) => string;
};
const resolved = Module._resolveFilename("server-only", module);
Module._cache[resolved] = { exports: {}, loaded: true, id: resolved };

import {
  PrismaClient,
  Prisma,
  JobStatus,
  LossType,
} from "@prisma/client";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

import {
  newScene,
  normaliseAndRecompute,
  randomId,
} from "../src/lib/business/sketch/scene";
import type {
  Door,
  SketchScene,
  Wall,
  Window as Win,
} from "../src/lib/business/sketch/types";
import { renderSceneSvg } from "../src/lib/business/sketch/svg";

const prisma = new PrismaClient();

async function nextJobNumber(orgId: string, prefix: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const rows = await prisma.$queryRaw<{ nextSeq: number }[]>(Prisma.sql`
    INSERT INTO "JobNumberCounter" ("id","organizationId","year","nextSeq")
    VALUES (gen_random_uuid()::text, ${orgId}, ${year}, 2)
    ON CONFLICT ("organizationId","year") DO UPDATE
      SET "nextSeq" = "JobNumberCounter"."nextSeq" + 1
    RETURNING ("nextSeq"-1) AS "nextSeq"
  `);
  return `${prefix}-${year}-${String(rows[0].nextSeq).padStart(4, "0")}`;
}

/** Helper: build a rectangular room out of 4 walls. */
function rectRoom(
  scene: SketchScene,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
): { walls: Wall[]; roomId: string; wallIds: string[] } {
  const ids = [randomId(), randomId(), randomId(), randomId()];
  const walls: Wall[] = [
    { id: ids[0], points: [x, y, x + w, y], thickness: 4 }, // N
    { id: ids[1], points: [x + w, y, x + w, y + h], thickness: 4 }, // E
    { id: ids[2], points: [x + w, y + h, x, y + h], thickness: 4 }, // S
    { id: ids[3], points: [x, y + h, x, y], thickness: 4 }, // W
  ];
  return {
    walls,
    roomId: randomId(),
    wallIds: ids,
  };
}

async function main() {
  const owner = await prisma.user.findUnique({
    where: { email: "owner@example.com" },
  });
  if (!owner) throw new Error("seed first");

  // wipe leftovers
  const leftover = await prisma.customer.findFirst({
    where: { organizationId: owner.organizationId, lastName: "Phase6-DoD" },
  });
  if (leftover) {
    await prisma.job.deleteMany({ where: { customerId: leftover.id } });
    await prisma.customer.delete({ where: { id: leftover.id } });
  }

  console.log("--- Phase 6 DoD ---");

  const customer = await prisma.customer.create({
    data: {
      organizationId: owner.organizationId,
      firstName: "Phase6",
      lastName: "Phase6-DoD",
      addressLine1: "12 Underlay Dr",
      city: "Garden City",
      state: "NY",
      postalCode: "11530",
    },
  });
  const org = await prisma.organization.findUnique({
    where: { id: owner.organizationId },
    select: { jobNumberPrefix: true },
  });
  const jobNumber = await nextJobNumber(
    owner.organizationId,
    org!.jobNumberPrefix,
  );
  const job = await prisma.job.create({
    data: {
      jobNumber,
      organizationId: owner.organizationId,
      customerId: customer.id,
      lossType: LossType.WATER,
      status: JobStatus.ACTIVE,
      createdById: owner.id,
      assignments: { create: { userId: owner.id, role: "lead" } },
    },
  });
  console.log(`Job ${job.jobNumber}`);

  // ----- build a 4-room scene -----------------------------------------------
  const scene = newScene();
  scene.scale.pixelsPerFoot = 10;
  const floor = scene.floors[0];

  // Kitchen 14×12 ft @ (0,0)
  const k = rectRoom(scene, "Kitchen", 0, 0, 140, 120);
  // Living Room 18×14 ft @ (140,0)
  const lr = rectRoom(scene, "Living Room", 140, 0, 180, 140);
  // Hallway 8×4 ft @ (140,140)
  const h = rectRoom(scene, "Hallway", 140, 140, 80, 40);
  // Bedroom 12×12 ft @ (220,140)
  const b = rectRoom(scene, "Bedroom", 220, 140, 120, 120);

  floor.walls = [...k.walls, ...lr.walls, ...h.walls, ...b.walls];
  floor.rooms = [
    { id: k.roomId, name: "Kitchen", wallIds: k.wallIds, ceilingHeightFt: 8 },
    { id: lr.roomId, name: "Living Room", wallIds: lr.wallIds, ceilingHeightFt: 8 },
    { id: h.roomId, name: "Hallway", wallIds: h.wallIds, ceilingHeightFt: 8 },
    { id: b.roomId, name: "Bedroom", wallIds: b.wallIds, ceilingHeightFt: 8 },
  ];

  // Place doors and windows on a few walls so the renderer hits every code path.
  const doors: Door[] = [
    { id: randomId(), wallId: k.wallIds[1], positionAlongWall: 0.5, widthIn: 32, swing: "left" }, // Kitchen → Living Room
    { id: randomId(), wallId: lr.wallIds[2], positionAlongWall: 0.6, widthIn: 36, swing: "right" }, // Living Room → Hallway
    { id: randomId(), wallId: h.wallIds[1], positionAlongWall: 0.5, widthIn: 30, swing: "left" }, // Hallway → Bedroom
  ];
  const windows: Win[] = [
    { id: randomId(), wallId: k.wallIds[0], positionAlongWall: 0.4, widthIn: 36, heightIn: 48, sillHeightIn: 36 },
    { id: randomId(), wallId: lr.wallIds[0], positionAlongWall: 0.3, widthIn: 60, heightIn: 60, sillHeightIn: 24 },
    { id: randomId(), wallId: lr.wallIds[0], positionAlongWall: 0.7, widthIn: 60, heightIn: 60, sillHeightIn: 24 },
    { id: randomId(), wallId: b.wallIds[1], positionAlongWall: 0.5, widthIn: 36, heightIn: 48, sillHeightIn: 36 },
  ];
  floor.doors = doors;
  floor.windows = windows;
  floor.labels = [
    { id: randomId(), x: 175, y: -16, text: "412 Stewart Ave — 1st Floor", fontSize: 14 },
  ];
  floor.dimensions = [
    { id: randomId(), from: [0, -10], to: [340, -10], offset: -20 },
  ];

  // Persist
  const recomputed = normaliseAndRecompute(scene);
  const sketch = await prisma.sketch.create({
    data: {
      jobId: job.id,
      name: "Floor 1",
      sceneData: recomputed as object,
      version: 1,
    },
  });
  console.log(`Persisted sketch: ${sketch.id}, ${recomputed.floors[0].rooms.length} rooms`);

  // Verify totals
  const totals = recomputed.floors[0].rooms.reduce(
    (acc, r) => ({
      sqft: acc.sqft + (r.cachedSqFt ?? 0),
      lf: acc.lf + (r.cachedLinearFt ?? 0),
    }),
    { sqft: 0, lf: 0 },
  );
  console.log(
    `Totals: ${totals.sqft.toFixed(0)} sqft (expect 168+252+32+144=596), ${totals.lf.toFixed(0)} lf`,
  );

  // ----- render PNG @ 1× and 2× ---------------------------------------------
  const svg = renderSceneSvg(recomputed, {
    pageWidthPx: 1100,
    pageHeightPx: 850,
    title: `${job.jobNumber} — Floor 1`,
    footer: "1-800 Water Damage of Nassau County",
  });

  const png1x = await sharp(Buffer.from(svg, "utf8"), { density: 96 }).png().toBuffer();
  const png2x = await sharp(Buffer.from(svg, "utf8"), { density: 192 }).png().toBuffer();
  await writeFile("/tmp/p6-1x.png", png1x);
  await writeFile("/tmp/p6-2x.png", png2x);
  const m1 = await sharp(png1x).metadata();
  const m2 = await sharp(png2x).metadata();
  console.log(
    `PNG 1×: ${png1x.byteLength} B  (${m1.width}×${m1.height}) ${(m1.width ?? 0) > 0 ? "✓" : "✗"}`,
  );
  console.log(
    `PNG 2×: ${png2x.byteLength} B  (${m2.width}×${m2.height}) ${(m2.width ?? 0) >= (m1.width ?? 0) * 1.8 ? "✓ crisper than 1×" : "✗"}`,
  );

  // ----- render PDF via Puppeteer -------------------------------------------
  const { exportScenePdf } = await import("../src/lib/business/sketch/export");
  const pdf = await exportScenePdf({
    scene: recomputed,
    title: `${job.jobNumber} — Floor 1`,
    footer: "1-800 Water Damage of Nassau County",
  });
  await writeFile("/tmp/p6.pdf", pdf.bytes);
  const head = pdf.bytes.slice(0, 5).toString();
  console.log(
    `PDF: ${pdf.bytes.byteLength} B, magic=${head} ${head === "%PDF-" ? "✓ valid PDF" : "✗ invalid"}`,
  );

  // ----- round-trip the scene through parseScene ----------------------------
  const { parseScene } = await import("../src/lib/business/sketch/scene");
  const fresh = await prisma.sketch.findUnique({ where: { id: sketch.id } });
  const reparsed = parseScene(fresh!.sceneData);
  console.log(
    `Round-trip: ${reparsed.floors[0].rooms.length} rooms, ${reparsed.floors[0].walls.length} walls ${reparsed.floors[0].walls.length === floor.walls.length ? "✓" : "✗"}`,
  );

  // cleanup
  await prisma.job.deleteMany({ where: { customerId: customer.id } });
  await prisma.customer.delete({ where: { id: customer.id } });
  await prisma.$disconnect();
  console.log("\nWritten: /tmp/p6-1x.png, /tmp/p6-2x.png, /tmp/p6.pdf");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
