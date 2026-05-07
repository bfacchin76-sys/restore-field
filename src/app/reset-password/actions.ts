"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { findUsableToken } from "@/lib/auth/tokens";
import { hashPassword } from "@/lib/auth/passwords";
import { recordAudit } from "@/lib/audit";

const inputSchema = z
  .object({
    token: z.string().min(10),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirm: z.string().min(8),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

export interface ResetPasswordResult {
  ok: boolean;
  message?: string;
}

export async function resetPassword(
  _prev: ResetPasswordResult,
  formData: FormData,
): Promise<ResetPasswordResult> {
  const parsed = inputSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check your inputs.",
    };
  }
  const { token, password } = parsed.data;

  const row = await findUsableToken(token, "PASSWORD_RESET");
  if (!row || !row.userId) {
    return {
      ok: false,
      message: "This reset link is invalid or has expired. Request a new one.",
    };
  }

  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: row.userId! },
      data: { passwordHash },
    });
    await tx.verificationToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
    // Invalidate any other unused password-reset tokens for this user
    await tx.verificationToken.updateMany({
      where: {
        userId: row.userId!,
        purpose: "PASSWORD_RESET",
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });
  });

  await recordAudit("auth.password_reset.completed", {
    actor: { userId: row.userId },
    jobId: null,
  });

  // We don't auto-login: force the user to sign in fresh.
  return {
    ok: true,
    message: "Your password has been updated. Sign in to continue.",
  };
}

