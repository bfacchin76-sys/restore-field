import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { env } from "@/lib/env";
import { ShareForm } from "./share-form";
import { ShareRow } from "./share-row";

export const dynamic = "force-dynamic";

function summariseScopes(perms: unknown): string {
  const p =
    perms && typeof perms === "object" ? (perms as Record<string, unknown>) : {};
  if (p.kind === "report" || (typeof p.reportId === "string" && p.reportId)) {
    return "Single report";
  }
  const scopes =
    p.scopes && typeof p.scopes === "object"
      ? (p.scopes as Record<string, unknown>)
      : {};
  const parts: string[] = [];
  if (scopes.photos) parts.push("Photos");
  if (scopes.readings) parts.push("Readings");
  if (scopes.dryingLogs) parts.push("Drying log");
  if (scopes.equipment) parts.push("Equipment");
  if (Array.isArray(scopes.reportIds) && scopes.reportIds.length > 0) {
    parts.push(`${scopes.reportIds.length} report(s)`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Empty";
}

export default async function ShareTabPage({
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
      shares: { orderBy: { createdAt: "desc" } },
      reports: {
        orderBy: { generatedAt: "desc" },
        select: {
          id: true,
          type: true,
          generatedAt: true,
          pdfStorageKey: true,
        },
      },
    },
  });
  if (!job || job.organizationId !== actor.organizationId) notFound();

  const canManage = can(actor, "report.generate", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const shareBaseUrl = `${env.NEXTAUTH_URL.replace(/\/$/, "")}/share`;

  return (
    <div className="space-y-4">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Share with adjuster / customer</CardTitle>
          </CardHeader>
          <CardContent>
            <ShareForm
              jobId={job.id}
              reports={job.reports.map((r) => ({
                id: r.id,
                type: r.type,
                generatedAt: r.generatedAt.toISOString(),
                pdfReady: r.pdfStorageKey.length > 0,
              }))}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Active &amp; past links ({job.shares.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {job.shares.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No share links yet.
            </p>
          ) : (
            <div className="space-y-2">
              {job.shares.map((s) => (
                <ShareRow
                  key={s.id}
                  shareId={s.id}
                  token={s.token}
                  recipientEmail={s.recipientEmail}
                  expiresAt={s.expiresAt.toISOString()}
                  revoked={s.revoked}
                  lastUsedAt={s.lastUsedAt?.toISOString() ?? null}
                  scopesSummary={summariseScopes(s.permissions)}
                  shareBaseUrl={shareBaseUrl}
                  canManage={canManage}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
