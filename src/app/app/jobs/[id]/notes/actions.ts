"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

const createInput = z.object({
  jobId: z.string().min(1),
  content: z.string().trim().min(1).max(4000),
});

export interface NoteActionResult {
  ok: boolean;
  message?: string;
  noteId?: string;
}

export async function createNoteAction(
  input: z.infer<typeof createInput>,
): Promise<NoteActionResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };
  const data = createInput.parse(input);

  const job = await prisma.job.findUnique({
    where: { id: data.jobId },
    select: {
      id: true,
      organizationId: true,
      assignments: { select: { userId: true } },
      createdById: true,
    },
  });
  if (!job) return { ok: false, message: "Job not found" };

  // Notes are flow-of-work commentary — anyone who can view the job can
  // append. We re-use job.update permission to be conservative.
  assertCan(actor, "job.update", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const note = await prisma.note.create({
    data: {
      jobId: data.jobId,
      content: data.content,
      authorId: actor.id,
    },
  });

  await recordAudit(
    "note.create",
    { actor: { userId: actor.id }, jobId: data.jobId },
    { noteId: note.id },
  );

  revalidatePath(`/app/jobs/${data.jobId}/notes`);
  return { ok: true, noteId: note.id };
}

const deleteInput = z.object({ noteId: z.string().min(1) });

export async function deleteNoteAction(input: z.infer<typeof deleteInput>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = deleteInput.parse(input);

  const note = await prisma.note.findUnique({
    where: { id: data.noteId },
    include: {
      job: {
        select: {
          id: true,
          organizationId: true,
          createdById: true,
          assignments: { select: { userId: true } },
        },
      },
    },
  });
  if (!note) return;

  // Author can delete; OWNER/OFFICE_ADMIN can also delete.
  if (note.authorId !== actor.id) {
    assertCan(actor, "user.manage", { id: note.job.organizationId });
  } else {
    assertCan(actor, "job.update", {
      id: note.job.id,
      organizationId: note.job.organizationId,
      assignedUserIds: note.job.assignments.map((a) => a.userId),
      createdById: note.job.createdById,
    });
  }

  await prisma.note.delete({ where: { id: data.noteId } });

  await recordAudit(
    "note.delete",
    { actor: { userId: actor.id }, jobId: note.jobId },
    { noteId: data.noteId },
  );

  revalidatePath(`/app/jobs/${note.jobId}/notes`);
}
