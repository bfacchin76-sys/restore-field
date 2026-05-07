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
import { OverviewForm } from "./overview-form";
import { StatusTransitions } from "./status-transitions";
import { Assignments } from "./assignments";

export const dynamic = "force-dynamic";

export default async function JobOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");

  const { id } = await params;
  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      customer: true,
      createdBy: { select: { name: true } },
      assignments: {
        include: { user: { select: { id: true, name: true, role: true } } },
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

  const teamCandidates = await prisma.user.findMany({
    where: {
      organizationId: actor.organizationId,
      active: true,
    },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, role: true, email: true },
  });

  const lossDateInput = job.lossDate
    ? job.lossDate.toISOString().slice(0, 10)
    : "";

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Scope</CardTitle>
          </CardHeader>
          <CardContent>
            <OverviewForm
              jobId={job.id}
              causeOfLoss={job.causeOfLoss ?? ""}
              scopeNotes={job.scopeNotes ?? ""}
              lossDate={lossDateInput}
              canEdit={canEdit}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusTransitions
              jobId={job.id}
              status={job.status}
              canEdit={canEdit}
            />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium">
              {job.customer.firstName} {job.customer.lastName}
            </p>
            <p className="text-muted-foreground">
              {job.customer.addressLine1}
              {job.customer.addressLine2 ? `, ${job.customer.addressLine2}` : ""}
            </p>
            <p className="text-muted-foreground">
              {job.customer.city}, {job.customer.state}{" "}
              {job.customer.postalCode}
            </p>
            {job.customer.phone ? (
              <p className="pt-2 text-xs">📞 {job.customer.phone}</p>
            ) : null}
            {job.customer.email ? (
              <p className="text-xs">✉ {job.customer.email}</p>
            ) : null}
            {job.customer.claimNumber ? (
              <p className="pt-2 text-xs">
                Claim # <span className="font-mono">{job.customer.claimNumber}</span>
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Team</CardTitle>
          </CardHeader>
          <CardContent>
            <Assignments
              jobId={job.id}
              assignments={job.assignments.map((a) => ({
                userId: a.userId,
                role: a.role,
                name: a.user.name,
                userRole: a.user.role,
              }))}
              candidates={teamCandidates}
              canEdit={canEdit}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Meta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <p>Created by {job.createdBy.name}</p>
            <p>Created {job.createdAt.toLocaleString()}</p>
            {job.firstResponseAt ? (
              <p>First response {job.firstResponseAt.toLocaleString()}</p>
            ) : null}
            {job.closedAt ? <p>Closed {job.closedAt.toLocaleString()}</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
