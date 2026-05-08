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
import { NotesPanel } from "./notes-panel";

export const dynamic = "force-dynamic";

export default async function NotesTabPage({
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
      notes: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { id: true, name: true } } },
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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Notes ({job.notes.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <NotesPanel
          jobId={job.id}
          actorId={actor.id}
          canEdit={canEdit}
          notes={job.notes.map((n) => ({
            id: n.id,
            content: n.content,
            authorName: n.author.name,
            authorId: n.author.id,
            createdAt: n.createdAt.toISOString(),
          }))}
        />
      </CardContent>
    </Card>
  );
}
