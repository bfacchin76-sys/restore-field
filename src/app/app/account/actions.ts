"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUserFresh } from "@/lib/auth/session";
import { generateTotpSetup, verifyTotp } from "@/lib/auth/totp";
import { recordAudit } from "@/lib/audit";

export interface TotpSetupResult {
  ok: boolean;
  message?: string;
  qrCodeDataUrl?: string;
  secret?: string;
}

/**
 * Generates a fresh TOTP secret + QR code. The candidate secret is returned
 * to the client and round-tripped through the confirm step — only persisted
 * on the User row when the user proves possession by entering a valid code.
 * If they abandon setup, nothing is written.
 */
export async function startTotpSetup(): Promise<TotpSetupResult> {
  const actor = await getSessionUserFresh();
  if (!actor) return { ok: false, message: "Not signed in." };

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { email: true, totpSecret: true },
  });
  if (!user) return { ok: false, message: "User not found." };

  if (user.totpSecret) {
    return {
      ok: false,
      message:
        "TOTP is already enabled. Disable it first to generate a new secret.",
    };
  }

  const setup = await generateTotpSetup(user.email);
  return {
    ok: true,
    qrCodeDataUrl: setup.qrCodeDataUrl,
    secret: setup.secret,
  };
}

const confirmSchema = z.object({
  secret: z.string().min(16),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export async function confirmTotpSetup(
  _prev: TotpSetupResult,
  formData: FormData,
): Promise<TotpSetupResult> {
  const actor = await getSessionUserFresh();
  if (!actor) return { ok: false, message: "Not signed in." };

  const parsed = confirmSchema.safeParse({
    secret: formData.get("secret"),
    code: formData.get("code"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message };
  }

  if (!verifyTotp(parsed.data.code, parsed.data.secret)) {
    return { ok: false, message: "That code didn't match. Try again." };
  }

  await prisma.user.update({
    where: { id: actor.id },
    data: { totpSecret: parsed.data.secret },
  });

  await recordAudit("auth.totp.enable", {
    actor: { userId: actor.id },
    jobId: null,
  });

  revalidatePath("/app/account");
  return {
    ok: true,
    message:
      "Two-factor authentication is enabled. You'll be asked for a code on your next sign-in.",
  };
}

export async function disableTotp(
  _prev: TotpSetupResult,
  formData: FormData,
): Promise<TotpSetupResult> {
  const actor = await getSessionUserFresh();
  if (!actor) return { ok: false, message: "Not signed in." };

  // Require the current code to disable, to prevent session-hijack disabling.
  const code = String(formData.get("code") ?? "").trim();
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { totpSecret: true },
  });
  if (!user?.totpSecret) {
    return { ok: false, message: "TOTP is not currently enabled." };
  }
  if (!verifyTotp(code, user.totpSecret)) {
    return { ok: false, message: "Enter your current authenticator code to disable." };
  }

  await prisma.user.update({
    where: { id: actor.id },
    data: { totpSecret: null },
  });

  await recordAudit("auth.totp.disable", {
    actor: { userId: actor.id },
    jobId: null,
  });

  revalidatePath("/app/account");
  return { ok: true, message: "Two-factor authentication has been disabled." };
}
