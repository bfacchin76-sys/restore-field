import "server-only";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { issueVerificationToken } from "@/lib/auth/tokens";
import { sendMail } from "@/lib/mailer";
import { subcontractorMagicLinkEmail } from "@/lib/auth/email-templates";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface IssueSubcontractorLinkInput {
  email: string;
  name: string;
  organizationId: string;
  /** Optional: pre-create a JobAssignment when the subcontractor signs in. */
  jobId?: string | null;
}

/**
 * Issues a magic-link token that, when clicked, signs in (or auto-creates)
 * a SUBCONTRACTOR user scoped to a single organization. PRD §7.
 *
 * Returns the raw URL token so callers can also display/copy it directly
 * during testing.
 */
export async function issueSubcontractorMagicLink(
  input: IssueSubcontractorLinkInput,
): Promise<{ rawToken: string; expiresAt: Date }> {
  const email = input.email.trim().toLowerCase();

  // Look up or pre-stage the user. We don't create the row until accept time,
  // to avoid orphaned accounts from un-clicked invites.
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, organizationId: true, role: true },
  });

  if (existing && existing.organizationId !== input.organizationId) {
    throw new Error(
      "Email already belongs to a user in another organization.",
    );
  }

  const { rawToken, expiresAt } = await issueVerificationToken({
    purpose: "MAGIC_LINK",
    email,
    userId: existing?.id ?? null,
    organizationId: input.organizationId,
    ttlMs: SEVEN_DAYS_MS,
    payload: {
      role: existing?.role ?? Role.SUBCONTRACTOR,
      name: input.name,
      jobId: input.jobId ?? null,
    },
  });

  const org = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { name: true },
  });
  const tpl = subcontractorMagicLinkEmail(org?.name ?? "FieldRestore", rawToken);
  await sendMail({ to: email, ...tpl });

  return { rawToken, expiresAt };
}
