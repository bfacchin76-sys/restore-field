import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SketchesActions } from "./sketches-actions";

export const dynamic = "force-dynamic";

export default async function SketchesTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");

  const { id } = await params;
  const job = await prisma.job.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      createdById: true,
      assignments: { select: { userId: true } },
      sketches: {
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          totalSqFt: true,
          totalLinearFt: true,
          version: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!job || job.organizationId !== actor.organizationId) notFound();

  const canEdit = can(actor, "job.update", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Sketches</CardTitle>
            <p className="text-xs text-muted-foreground">
              Floor plans for Xactimate underlay export. PNG (1×, 2×) and PDF.
            </p>
          </div>
          {canEdit ? <SketchesActions jobId={job.id} /> : null}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {job.sketches.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">
              No sketches yet. Use &ldquo;New sketch&rdquo; above to start one.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3 text-right">Total sq ft</th>
                  <th className="px-6 py-3 text-right">Linear ft</th>
                  <th className="px-6 py-3">Last saved</th>
                  <th className="px-6 py-3 text-right" />
                </tr>
              </thead>
              <tbody>
                {job.sketches.map((s) => (
                  <tr key={s.id} className="border-b last:border-b-0">
                    <td className="px-6 py-2 font-medium">
                      <Link
                        href={`/app/jobs/${job.id}/sketches/${s.id}`}
                        className="hover:underline"
                      >
                        {s.name}
                      </Link>
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        v{s.version}
                      </span>
                    </td>
                    <td className="px-6 py-2 text-right tabular-nums">
                      {s.totalSqFt ? s.totalSqFt.toFixed(0) : "—"}
                    </td>
                    <td className="px-6 py-2 text-right tabular-nums">
                      {s.totalLinearFt ? s.totalLinearFt.toFixed(0) : "—"}
                    </td>
                    <td className="px-6 py-2 text-xs text-muted-foreground">
                      {s.updatedAt.toLocaleString()}
                    </td>
                    <td className="px-6 py-2 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                        <a
                          href={`/api/sketches/${s.id}/export?format=png&dpi=2`}
                          className="font-medium text-primary hover:underline"
                          title="2× DPI underlay PNG for Xactimate"
                        >
                          PNG 2×
                        </a>
                        <a
                          href={`/api/sketches/${s.id}/export?format=png&dpi=1`}
                          className="text-muted-foreground hover:underline"
                        >
                          PNG 1×
                        </a>
                        <a
                          href={`/api/sketches/${s.id}/export?format=pdf`}
                          className="text-muted-foreground hover:underline"
                        >
                          PDF
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-base text-blue-900">
            Xactimate import workflow
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs text-blue-900">
          <p>1. Click <strong>PNG 2×</strong> on the sketch above to download an underlay image.</p>
          <p>
            2. In Xactimate desktop: open the project →{" "}
            <strong>Estimate → Sketch → Options → Import → Import Underlay Image</strong>{" "}
            and select the file.
          </p>
          <p>3. Trace walls over the underlay using Xactimate&apos;s wall tool — measurements stay legible at 2× DPI.</p>
        </CardContent>
      </Card>
    </div>
  );
}
