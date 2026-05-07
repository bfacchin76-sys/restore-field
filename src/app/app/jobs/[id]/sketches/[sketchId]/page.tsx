import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import { parseScene } from "@/lib/business/sketch/scene";
import { SketchEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function SketchEditorPage({
  params,
}: {
  params: Promise<{ id: string; sketchId: string }>;
}) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");

  const { id, sketchId } = await params;

  const sketch = await prisma.sketch.findUnique({
    where: { id: sketchId },
    include: {
      job: {
        select: {
          id: true,
          jobNumber: true,
          organizationId: true,
          createdById: true,
          assignments: { select: { userId: true } },
        },
      },
    },
  });
  if (!sketch || sketch.jobId !== id || sketch.job.organizationId !== actor.organizationId) {
    notFound();
  }

  const canEdit = can(actor, "job.update", {
    id: sketch.job.id,
    organizationId: sketch.job.organizationId,
    assignedUserIds: sketch.job.assignments.map((a) => a.userId),
    createdById: sketch.job.createdById,
  });

  // Parse the scene server-side so the editor never sees stale/corrupt JSON.
  const scene = parseScene(sketch.sceneData);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link
              href={`/app/jobs/${id}/sketches`}
              className="hover:underline"
            >
              ← All sketches
            </Link>
          </p>
          <h1 className="text-xl font-semibold tracking-tight">
            {sketch.name}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              v{sketch.version}
            </span>
          </h1>
          <p className="text-xs text-muted-foreground">
            {sketch.job.jobNumber}
            {sketch.totalSqFt
              ? ` · ${sketch.totalSqFt.toFixed(0)} sq ft · ${sketch.totalLinearFt?.toFixed(0) ?? "?"} lf`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <a
            href={`/api/sketches/${sketch.id}/export?format=png&dpi=2`}
            className="rounded-md border border-input bg-background px-3 py-1.5 hover:bg-accent"
          >
            PNG 2×
          </a>
          <a
            href={`/api/sketches/${sketch.id}/export?format=png&dpi=1`}
            className="rounded-md border border-input bg-background px-3 py-1.5 hover:bg-accent"
          >
            PNG 1×
          </a>
          <a
            href={`/api/sketches/${sketch.id}/export?format=pdf`}
            className="rounded-md border border-input bg-background px-3 py-1.5 hover:bg-accent"
          >
            PDF
          </a>
        </div>
      </div>

      <SketchEditor
        sketchId={sketch.id}
        initialScene={scene}
        canEdit={canEdit}
      />
    </div>
  );
}
