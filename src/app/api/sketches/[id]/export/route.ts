import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/lib/audit";
import { parseScene } from "@/lib/business/sketch/scene";
import {
  exportScenePdf,
  exportScenePng,
} from "@/lib/business/sketch/export";

export const dynamic = "force-dynamic";

/**
 * Render endpoint — `POST /api/sketches/:id/export?format=png|pdf&dpi=1|2`
 * (PRD §8.3). Returns the binary directly; the browser saves it to disk.
 *
 * No file storage round-trip in v1 — sketches are short and re-render is
 * fast enough to do on demand. Adding a Sketch.pngStorageKey cache layer
 * is a v2 concern.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const sketch = await prisma.sketch.findUnique({
    where: { id },
    include: {
      job: {
        select: {
          id: true,
          jobNumber: true,
          organizationId: true,
          createdById: true,
          assignments: { select: { userId: true } },
          customer: {
            select: { firstName: true, lastName: true, addressLine1: true, city: true },
          },
          organization: { select: { name: true } },
        },
      },
    },
  });
  if (!sketch) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowed = can(
    {
      id: session.user.id,
      role: session.user.role,
      organizationId: session.user.organizationId,
      active: session.user.active,
    },
    "job.view",
    {
      id: sketch.job.id,
      organizationId: sketch.job.organizationId,
      assignedUserIds: sketch.job.assignments.map((a) => a.userId),
      createdById: sketch.job.createdById,
    },
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = request.nextUrl;
  const format = (url.searchParams.get("format") ?? "png").toLowerCase();
  const dpiRaw = url.searchParams.get("dpi") ?? "2";
  const dpi = dpiRaw === "1" || dpiRaw === "96" ? 96 : 192;

  let scene;
  try {
    scene = parseScene(sketch.sceneData);
  } catch (err) {
    logger.error({ err }, "sketch scene invalid");
    return NextResponse.json({ error: "Sketch is corrupt" }, { status: 422 });
  }

  const title = `${sketch.job.jobNumber} — ${sketch.name}`;
  const cust = sketch.job.customer;
  const footer = `${sketch.job.organization.name}  ·  ${cust.firstName} ${cust.lastName}, ${cust.addressLine1}, ${cust.city}`;

  await recordAudit(
    "sketch.export",
    { actor: { userId: session.user.id }, jobId: sketch.jobId },
    { sketchId: sketch.id, format, dpi },
  );

  if (format === "pdf") {
    const pdf = await exportScenePdf({ scene, title, footer });
    const fname = `${sketch.job.jobNumber}-${sketch.name}.pdf`.replace(
      /[^a-z0-9._-]/gi,
      "_",
    );
    return new NextResponse(new Uint8Array(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fname}"`,
        "Cache-Control": "private, max-age=0",
      },
    });
  }

  // PNG (default)
  const png = await exportScenePng({ scene, title, footer }, dpi as 96 | 192);
  const fname = `${sketch.job.jobNumber}-${sketch.name}-${dpi === 192 ? "2x" : "1x"}.png`.replace(
    /[^a-z0-9._-]/gi,
    "_",
  );
  return new NextResponse(new Uint8Array(png.bytes), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "private, max-age=0",
    },
  });
}
