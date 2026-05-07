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
import { RoomForm } from "./room-form";
import { RoomList } from "./room-list";
import { AFFECTED_MATERIALS } from "@/lib/business/affected-materials";

export const dynamic = "force-dynamic";

export default async function RoomsPage({
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
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
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
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Rooms ({job.rooms.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <RoomList
            jobId={job.id}
            rooms={job.rooms.map((r) => ({
              id: r.id,
              name: r.name,
              floor: r.floor,
              lengthFt: r.lengthFt,
              widthFt: r.widthFt,
              heightFt: r.heightFt,
              category: r.category,
              classOfLoss: r.classOfLoss,
              notes: r.notes,
              affectedMaterials: Array.isArray(r.affectedMaterials)
                ? (r.affectedMaterials as string[])
                : [],
            }))}
            allMaterials={[...AFFECTED_MATERIALS]}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Add a room</CardTitle>
          </CardHeader>
          <CardContent>
            <RoomForm jobId={job.id} allMaterials={[...AFFECTED_MATERIALS]} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
