import { notFound, redirect } from "next/navigation";
import { Material, MeterType } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  groupBySurface,
  stuckSurfaces,
  STUCK_DAY_THRESHOLD,
} from "@/lib/business/moisture";
import { ReadingForm } from "./reading-form";
import { ReadingList } from "./reading-list";
import { SurfaceCharts } from "./surface-charts";
import { BulkReadingsForm } from "./bulk-readings-form";

export const dynamic = "force-dynamic";

interface MoisturePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ room?: string }>;
}

export default async function MoistureTabPage({
  params,
  searchParams,
}: MoisturePageProps) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");

  const { id } = await params;
  const sp = await searchParams;

  const job = await prisma.job.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      createdById: true,
      assignments: { select: { userId: true } },
      rooms: {
        orderBy: [{ sortOrder: "asc" }],
        select: { id: true, name: true },
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

  const roomFilter = sp.room && sp.room.length ? sp.room : null;

  const readings = await prisma.moistureReading.findMany({
    where: {
      jobId: id,
      ...(roomFilter ? { roomId: roomFilter } : {}),
    },
    orderBy: { takenAt: "asc" },
    take: 2000,
    include: {
      room: { select: { id: true, name: true } },
      takenBy: { select: { name: true } },
    },
  });

  const series = groupBySurface(
    readings.map((r) => ({
      id: r.id,
      roomId: r.roomId,
      surface: r.surface,
      moistureValue: r.moistureValue,
      scaleType: r.scaleType,
      isDryGoal: r.isDryGoal,
      isInitial: r.isInitial,
      isDry: r.isDry,
      takenAt: r.takenAt,
    })),
  );
  const stuck = stuckSurfaces(series);

  // Distinct surface suggestions for the autocomplete on this job.
  const distinctSurfaces = await prisma.moistureReading.findMany({
    where: { jobId: id },
    distinct: ["surface"],
    select: { surface: true },
    take: 100,
  });

  const linkFor = (overrides: { room?: string | null }) => {
    const u = new URLSearchParams();
    const room = overrides.room ?? roomFilter;
    if (room) u.set("room", room);
    const qs = u.toString();
    return qs
      ? `/app/jobs/${id}/moisture?${qs}`
      : `/app/jobs/${id}/moisture`;
  };

  return (
    <div className="space-y-6">
      {stuck.length > 0 ? (
        <Card className="border-orange-300 bg-orange-50">
          <CardHeader>
            <CardTitle className="text-base text-orange-900">
              {stuck.length} surface{stuck.length === 1 ? "" : "s"} stuck (
              &gt; {STUCK_DAY_THRESHOLD} days without progress)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-orange-900">
              {stuck.map((s) => (
                <li key={s.key}>
                  <strong>{s.surface}</strong>
                  {s.roomId
                    ? ` (${job.rooms.find((r) => r.id === s.roomId)?.name ?? ""})`
                    : ""}
                  {" — "}
                  {s.daysWithoutProgress} days · latest{" "}
                  {s.latestValue.toFixed(1)}
                  {s.dryGoalValue != null
                    ? ` (goal ${s.dryGoalValue.toFixed(1)})`
                    : ""}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Add reading</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <ReadingForm
              jobId={id}
              rooms={job.rooms}
              surfaceSuggestions={distinctSurfaces.map((d) => d.surface)}
              materials={Object.values(Material)}
              meterTypes={Object.values(MeterType)}
            />
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Bulk entry — same surface, multiple values
              </summary>
              <div className="mt-3">
                <BulkReadingsForm
                  jobId={id}
                  rooms={job.rooms}
                  materials={Object.values(Material)}
                  meterTypes={Object.values(MeterType)}
                />
              </div>
            </details>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Charts ({series.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <SurfaceCharts
            series={series.map((s) => ({
              key: s.key,
              surface: s.surface,
              roomName: job.rooms.find((r) => r.id === s.roomId)?.name ?? null,
              dryGoalValue: s.dryGoalValue,
              reachedGoal: s.reachedGoal,
              stuck: s.stuck,
              daysWithoutProgress: s.daysWithoutProgress,
              points: s.readings.map((r) => ({
                t: r.takenAt.toISOString(),
                value: r.moistureValue,
                isDryGoal: r.isDryGoal,
              })),
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-end justify-between gap-2">
            <div>
              <CardTitle className="text-lg">
                Readings ({readings.length})
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Newest first.
              </p>
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              <a
                href={linkFor({ room: null })}
                className={`rounded-full border px-2.5 py-0.5 ${
                  !roomFilter
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                all
              </a>
              {job.rooms.map((r) => (
                <a
                  key={r.id}
                  href={linkFor({ room: r.id })}
                  className={`rounded-full border px-2.5 py-0.5 ${
                    roomFilter === r.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {r.name}
                </a>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <ReadingList
            readings={readings.map((r) => ({
              id: r.id,
              roomName: r.room?.name ?? null,
              surface: r.surface,
              material: r.material,
              meterType: r.meterType,
              moistureValue: r.moistureValue,
              scaleType: r.scaleType,
              isDryGoal: r.isDryGoal,
              isInitial: r.isInitial,
              isDry: r.isDry,
              takenAt: r.takenAt.toISOString(),
              takenBy: r.takenBy.name,
              notes: r.notes,
            }))}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
