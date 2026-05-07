import { notFound, redirect } from "next/navigation";
import { FormStatus } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SendFormForm } from "./send-form-form";
import { SubmissionRow } from "./submission-row";

export const dynamic = "force-dynamic";

export default async function FormsTabPage({
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
      assignments: { select: { userId: true } },
      customer: {
        select: { firstName: true, lastName: true, email: true },
      },
      formSubmissions: {
        orderBy: { createdAt: "desc" },
        include: {
          template: { select: { name: true } },
          signatures: {
            select: { id: true, signerName: true, signedAt: true, signerRole: true },
          },
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

  const templates = await prisma.formTemplate.findMany({
    where: {
      organizationId: actor.organizationId,
      active: true,
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const completedCount = job.formSubmissions.filter(
    (s) => s.status === FormStatus.COMPLETED,
  ).length;
  const sentCount = job.formSubmissions.filter(
    (s) => s.status === FormStatus.SENT,
  ).length;

  return (
    <div className="space-y-6">
      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Send a form for signing</CardTitle>
          </CardHeader>
          <CardContent>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active templates. Create one in{" "}
                <a className="text-primary hover:underline" href="/app/admin/forms">
                  Admin → Forms
                </a>.
              </p>
            ) : (
              <SendFormForm
                jobId={job.id}
                templates={templates}
                defaultEmail={job.customer.email ?? ""}
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-end justify-between gap-2">
            <div>
              <CardTitle className="text-lg">
                Submissions ({job.formSubmissions.length})
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {completedCount} signed · {sentCount} awaiting signature
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {job.formSubmissions.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No forms yet. Use the form above to send one.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-6 py-3">Template</th>
                  <th className="px-6 py-3">Recipient</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Signed</th>
                  <th className="px-6 py-3">Sent</th>
                  <th className="px-6 py-3 text-right" />
                </tr>
              </thead>
              <tbody>
                {job.formSubmissions.map((s) => (
                  <SubmissionRow
                    key={s.id}
                    canEdit={canEdit}
                    submission={{
                      id: s.id,
                      templateName: s.template.name,
                      sentToEmail: s.sentToEmail,
                      sentAt: s.sentAt?.toISOString() ?? null,
                      completedAt: s.completedAt?.toISOString() ?? null,
                      status: s.status,
                      signers: s.signatures.map((sig) => ({
                        name: sig.signerName,
                        role: sig.signerRole,
                        at: sig.signedAt.toISOString(),
                      })),
                      hasPdf: !!s.renderedPdfKey,
                    }}
                  />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
