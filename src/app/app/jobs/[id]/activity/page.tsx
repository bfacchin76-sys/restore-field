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

export const dynamic = "force-dynamic";

export default async function ActivityTabPage({
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
    },
  });
  if (!job || job.organizationId !== actor.organizationId) notFound();

  if (
    !can(actor, "job.view", {
      id: job.id,
      organizationId: job.organizationId,
      assignedUserIds: job.assignments.map((a) => a.userId),
      createdById: job.createdById,
    })
  ) {
    redirect("/app/jobs");
  }

  const rows = await prisma.auditLog.findMany({
    where: { jobId: id },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { user: { select: { name: true, email: true } } },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Activity</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            No activity recorded for this job yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-6 py-3">When</th>
                <th className="px-6 py-3">Who</th>
                <th className="px-6 py-3">Action</th>
                <th className="px-6 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0">
                  <td className="px-6 py-2 text-xs text-muted-foreground">
                    {r.createdAt.toLocaleString()}
                  </td>
                  <td className="px-6 py-2 text-xs">
                    {r.user?.name ?? "system"}
                  </td>
                  <td className="px-6 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-6 py-2 font-mono text-[11px] text-muted-foreground">
                    {summariseDetails(r.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function summariseDetails(details: unknown): string {
  if (!details || typeof details !== "object") return "";
  const obj = details as Record<string, unknown>;
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" · ");
}
