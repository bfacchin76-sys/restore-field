import { notFound, redirect } from "next/navigation";
import { WaterCategory, WaterClass } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { recommendEquipment } from "@/lib/business/equipment-recommendation";
import { DryingLogForm } from "./drying-log-form";
import { DryingLogTable } from "./drying-log-table";

export const dynamic = "force-dynamic";

const CAT_RANK: Record<WaterCategory, number> = { CAT_1: 1, CAT_2: 2, CAT_3: 3 };
const CLASS_RANK: Record<WaterClass, number> = {
  CLASS_1: 1,
  CLASS_2: 2,
  CLASS_3: 3,
  CLASS_4: 4,
};

export default async function DryingTabPage({
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
      lossType: true,
      createdById: true,
      assignments: { select: { userId: true } },
      rooms: {
        select: {
          lengthFt: true,
          widthFt: true,
          category: true,
          classOfLoss: true,
        },
      },
      dryingLogs: {
        orderBy: { logDate: "desc" },
        take: 90,
      },
    },
  });
  if (!job || job.organizationId !== actor.organizationId) notFound();

  const canEdit = can(actor, "reading.create", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  // Compute affected sqft for the equipment recommendation banner.
  let affectedSqFt = 0;
  let worstCategory: WaterCategory | null = null;
  let worstClass: WaterClass | null = null;
  for (const r of job.rooms) {
    if (r.lengthFt && r.widthFt) {
      affectedSqFt += r.lengthFt * r.widthFt;
    }
    if (
      r.category &&
      (worstCategory === null || CAT_RANK[r.category] > CAT_RANK[worstCategory])
    ) {
      worstCategory = r.category;
    }
    if (
      r.classOfLoss &&
      (worstClass === null ||
        CLASS_RANK[r.classOfLoss] > CLASS_RANK[worstClass])
    ) {
      worstClass = r.classOfLoss;
    }
  }
  const recommendation = recommendEquipment({
    affectedSqFt: Math.round(affectedSqFt),
    worstCategory,
    worstClass,
  });

  // Today's row (UTC midnight). If none, the form renders a fresh one.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayLog = job.dryingLogs.find(
    (l) => l.logDate.getTime() === today.getTime(),
  );

  return (
    <div className="space-y-6">
      {job.lossType === "WATER" && affectedSqFt > 0 ? (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-base text-blue-900">
              Equipment recommendation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-blue-900">
            <p>
              <strong>{recommendation.airMovers}</strong> air movers ·{" "}
              <strong>{recommendation.lgrDehumidifiers}</strong> LGR
              dehumidifier
              {recommendation.lgrDehumidifiers === 1 ? "" : "s"}
              {recommendation.airScrubbers > 0
                ? ` · ${recommendation.airScrubbers} HEPA scrubber${recommendation.airScrubbers === 1 ? "" : "s"}`
                : ""}
            </p>
            <p className="text-xs text-blue-900/80">
              {recommendation.rationale}
            </p>
            <p className="text-[11px] text-blue-900/70">
              Conservative starting point — adjust on-site per IICRC S500.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {todayLog ? "Today's drying log" : "Start today's drying log"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DryingLogForm
              jobId={job.id}
              logDate={today.toISOString().slice(0, 10)}
              initial={todayLog ?? null}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Drying history ({job.dryingLogs.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <DryingLogTable logs={job.dryingLogs} />
        </CardContent>
      </Card>
    </div>
  );
}
