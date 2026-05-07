import { notFound, redirect } from "next/navigation";
import { EquipmentStatus } from "@prisma/client";
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
  dailyEquipmentCounts,
  type PlacementForCount,
} from "@/lib/business/equipment";
import { PlaceEquipmentForm } from "./place-form";
import { PlacementRow } from "./placement-row";
import { EquipmentTimeline } from "./equipment-timeline";

export const dynamic = "force-dynamic";

export default async function EquipmentTabPage({
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
      rooms: {
        orderBy: [{ sortOrder: "asc" }],
        select: { id: true, name: true },
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

  const placements = await prisma.equipmentPlacement.findMany({
    where: { jobId: id },
    orderBy: { placedAt: "asc" },
    include: {
      equipment: {
        select: {
          id: true,
          assetTag: true,
          type: true,
          manufacturer: true,
          model: true,
        },
      },
      room: { select: { id: true, name: true } },
    },
  });

  const open = placements.filter((p) => p.removedAt === null);
  const closed = placements.filter((p) => p.removedAt !== null);

  // Daily-count summary across the whole job span (or last 14 days, whichever
  // is smaller).
  let from = new Date();
  let to = new Date();
  if (placements.length) {
    from = new Date(
      Math.min(...placements.map((p) => p.placedAt.getTime())),
    );
    to = new Date(
      Math.max(
        ...placements.map((p) => (p.removedAt ?? new Date()).getTime()),
      ),
    );
  }
  const counts = dailyEquipmentCounts(
    placements.map<PlacementForCount>((p) => ({
      equipmentId: p.equipmentId,
      type: p.equipment.type,
      placedAt: p.placedAt,
      removedAt: p.removedAt,
    })),
    from,
    to,
  );

  // Available units (organisation-scoped) for the placement form picker
  const available = canEdit
    ? await prisma.equipment.findMany({
        where: {
          organizationId: actor.organizationId,
          status: EquipmentStatus.AVAILABLE,
        },
        orderBy: [{ type: "asc" }, { assetTag: "asc" }],
        take: 500,
        select: {
          id: true,
          assetTag: true,
          type: true,
          manufacturer: true,
          model: true,
        },
      })
    : [];

  return (
    <div className="space-y-6">
      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Place equipment</CardTitle>
          </CardHeader>
          <CardContent>
            {available.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No equipment is currently available. Add units in{" "}
                <a className="text-primary hover:underline" href="/app/equipment">
                  Equipment master
                </a>{" "}
                or remove a unit from another job first.
              </p>
            ) : (
              <PlaceEquipmentForm
                jobId={job.id}
                rooms={job.rooms}
                available={available}
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Currently deployed ({open.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {open.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No units deployed on this job right now.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-6 py-3">Asset tag</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Room</th>
                  <th className="px-6 py-3">Placed</th>
                  <th className="px-6 py-3">Notes</th>
                  {canEdit ? <th className="px-6 py-3 text-right" /> : null}
                </tr>
              </thead>
              <tbody>
                {open.map((p) => (
                  <PlacementRow
                    key={p.id}
                    jobId={job.id}
                    placement={{
                      id: p.id,
                      assetTag: p.equipment.assetTag,
                      type: p.equipment.type,
                      manufacturer: p.equipment.manufacturer,
                      model: p.equipment.model,
                      roomName: p.room?.name ?? null,
                      placedAt: p.placedAt.toISOString(),
                      removedAt: null,
                      notes: p.notes,
                    }}
                    canEdit={canEdit}
                  />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {placements.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <EquipmentTimeline
              placements={placements.map((p) => ({
                id: p.id,
                assetTag: p.equipment.assetTag,
                type: p.equipment.type,
                placedAt: p.placedAt.toISOString(),
                removedAt: p.removedAt?.toISOString() ?? null,
              }))}
              counts={counts.map((c) => ({
                day: c.day.toISOString().slice(0, 10),
                total: c.total,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      {closed.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Removed ({closed.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-6 py-3">Asset tag</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Room</th>
                  <th className="px-6 py-3">Placed</th>
                  <th className="px-6 py-3">Removed</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((p) => (
                  <tr key={p.id} className="border-b last:border-b-0">
                    <td className="px-6 py-2 font-mono text-xs">
                      {p.equipment.assetTag}
                    </td>
                    <td className="px-6 py-2 text-xs uppercase">
                      {p.equipment.type.replace(/_/g, " ").toLowerCase()}
                    </td>
                    <td className="px-6 py-2 text-xs">
                      {p.room?.name ?? "—"}
                    </td>
                    <td className="px-6 py-2 text-xs text-muted-foreground">
                      {p.placedAt.toLocaleString()}
                    </td>
                    <td className="px-6 py-2 text-xs text-muted-foreground">
                      {p.removedAt?.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
