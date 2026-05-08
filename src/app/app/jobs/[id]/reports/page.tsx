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
import { GenerateReportForm } from "./generate-form";
import { ReportRow } from "./report-row";

export const dynamic = "force-dynamic";

export default async function ReportsTabPage({
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
      organization: {
        select: { overheadProfitRate: true, salesTaxRate: true },
      },
      reports: {
        orderBy: { generatedAt: "desc" },
        include: { generatedBy: { select: { name: true } } },
      },
    },
  });
  if (!job || job.organizationId !== actor.organizationId) notFound();

  const canGenerate = can(actor, "report.generate", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  return (
    <div className="space-y-4">
      {canGenerate && (
        <GenerateReportForm
          jobId={job.id}
          defaultOverheadProfitRate={job.organization.overheadProfitRate}
          defaultSalesTaxRate={job.organization.salesTaxRate}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Reports</CardTitle>
        </CardHeader>
        <CardContent>
          {job.reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No reports yet. Generate one above.
            </p>
          ) : (
            <div className="space-y-2">
              {job.reports.map((r) => (
                <ReportRow
                  key={r.id}
                  reportId={r.id}
                  type={r.type}
                  generatedAt={r.generatedAt.toISOString()}
                  pdfReady={Boolean(r.pdfStorageKey)}
                  processingError={r.processingError}
                  generatedByName={r.generatedBy.name}
                  canEdit={canGenerate}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
