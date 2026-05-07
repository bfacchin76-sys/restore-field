"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { issueVerificationToken } from "@/lib/auth/tokens";
import { passwordResetEmail } from "@/lib/auth/email-templates";
import { sendMail } from "@/lib/mailer";
import { recordAudit } from "@/lib/audit";

const inputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export interface ForgotPasswordResult {
  ok: boolean;
  message?: string;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

export async function requestPasswordReset(
  _prev: ForgotPasswordResult,
  formData: FormData,
): Promise<ForgotPasswordResult> {
  const parsed = inputSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ok: false, message: "Enter a valid email." };
  }
  const { email } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  // We always respond the same way; don't leak which emails exist.
  if (user && user.active && user.passwordHash) {
    const { rawToken } = await issueVerificationToken({
      purpose: "PASSWORD_RESET",
      email,
      userId: user.id,
      organizationId: user.organizationId,
      ttlMs: ONE_HOUR_MS,
    });
    const tpl = passwordResetEmail(rawToken);
    await sendMail({ to: email, ...tpl });
    await recordAudit("auth.password_reset.requested", {
      actor: { userId: user.id },
      jobId: null,
    });
  }

  return {
    ok: true,
    message:
      "If that email is on file, we've sent a reset link. Check your inbox (or, in dev, the server log).",
  };
}
