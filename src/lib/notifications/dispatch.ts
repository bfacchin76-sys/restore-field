import "server-only";
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { getPreferences } from "./preferences";

/**
 * Notify all users assigned to a job — and the creator — when its
 * status changes. Respects each recipient's
 * `emailJobStatusChange` preference (default ON).
 *
 * Best-effort: a failed mailer doesn't break the calling action.
 */
export async function notifyJobStatusChange(input: {
  jobId: string;
  fromStatus: string;
  toStatus: string;
  changedById: string;
}): Promise<void> {
  try {
    const job = await prisma.job.findUnique({
      where: { id: input.jobId },
      select: {
        jobNumber: true,
        createdById: true,
        organization: { select: { name: true } },
        customer: { select: { firstName: true, lastName: true } },
        assignments: {
          select: {
            user: { select: { id: true, name: true, email: true, active: true } },
          },
        },
        createdBy: { select: { id: true, name: true, email: true, active: true } },
      },
    });
    if (!job) return;

    const candidates = new Map<string, { id: string; email: string; name: string }>();
    for (const a of job.assignments) {
      if (a.user.active) {
        candidates.set(a.user.id, {
          id: a.user.id,
          email: a.user.email,
          name: a.user.name,
        });
      }
    }
    if (job.createdBy?.active) {
      candidates.set(job.createdBy.id, {
        id: job.createdBy.id,
        email: job.createdBy.email,
        name: job.createdBy.name,
      });
    }
    candidates.delete(input.changedById); // don't email the actor

    if (candidates.size === 0) return;

    const url = `${env.NEXTAUTH_URL.replace(/\/$/, "")}/app/jobs/${input.jobId}`;
    const subject = `[${job.organization.name}] Job ${job.jobNumber} → ${input.toStatus.replace("_", " ").toLowerCase()}`;

    await Promise.all(
      Array.from(candidates.values()).map(async (u) => {
        const prefs = await getPreferences(u.id);
        if (!prefs.emailJobStatusChange) return;
        await sendMail({
          to: u.email,
          subject,
          text: [
            `Hi ${u.name},\n\n`,
            `Job ${job.jobNumber} (${job.customer.firstName} ${job.customer.lastName}) `,
            `moved from ${input.fromStatus.replace("_", " ").toLowerCase()} to ${input.toStatus.replace("_", " ").toLowerCase()}.\n\n`,
            `${url}\n\n`,
            `You're receiving this because you're assigned to or created this job. `,
            `Update your preferences at ${env.NEXTAUTH_URL}/app/account.\n`,
          ].join(""),
        });
      }),
    );
  } catch (err) {
    logger.warn({ err, jobId: input.jobId }, "notifyJobStatusChange failed");
  }
}

export async function notifyJobAssigned(input: {
  jobId: string;
  userId: string;
  assignedById: string;
}): Promise<void> {
  if (input.userId === input.assignedById) return;
  try {
    const [user, job] = await Promise.all([
      prisma.user.findUnique({
        where: { id: input.userId },
        select: { name: true, email: true, active: true },
      }),
      prisma.job.findUnique({
        where: { id: input.jobId },
        select: {
          jobNumber: true,
          organization: { select: { name: true } },
          customer: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);
    if (!user?.active || !job) return;

    const prefs = await getPreferences(input.userId);
    if (!prefs.emailJobAssigned) return;

    const url = `${env.NEXTAUTH_URL.replace(/\/$/, "")}/app/jobs/${input.jobId}`;
    await sendMail({
      to: user.email,
      subject: `[${job.organization.name}] You're assigned to ${job.jobNumber}`,
      text:
        `Hi ${user.name},\n\nYou've been assigned to ${job.jobNumber} ` +
        `(${job.customer.firstName} ${job.customer.lastName}).\n\n${url}\n`,
    });
  } catch (err) {
    logger.warn({ err, jobId: input.jobId }, "notifyJobAssigned failed");
  }
}
