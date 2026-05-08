"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { AUTH_ERRORS } from "@/auth";
import {
  checkAuthAttempt,
  clearAuthAttempt,
} from "@/lib/security/auth-throttle";

export interface LoginActionResult {
  ok: boolean;
  /** machine-readable code, see AUTH_ERRORS */
  code?: string;
  /** user-facing message */
  message?: string;
  /** whether the form should now reveal the TOTP field */
  needsTotp?: boolean;
}

const SAFE_NEXT_PATTERN = /^\/app(\/[\w\-/?#=&%.]*)?$/;
function safeNext(input: FormDataEntryValue | null): string {
  const v = typeof input === "string" ? input : "";
  return SAFE_NEXT_PATTERN.test(v) ? v : "/app";
}

export async function loginAction(
  _prev: LoginActionResult,
  formData: FormData,
): Promise<LoginActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const totp = String(formData.get("totp") ?? "").trim();
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return {
      ok: false,
      code: AUTH_ERRORS.INVALID_CREDENTIALS,
      message: "Email and password are required.",
    };
  }

  // PRD §11: brute-force protection — 5 attempts per 15 min per email,
  // 10 per 15 min per IP. Successful login clears the email counter.
  const throttle = await checkAuthAttempt({ flow: "login", identifier: email });
  if (!throttle.ok) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      message: `Too many sign-in attempts. Try again in ${Math.ceil(throttle.retryAfterSeconds / 60)} min.`,
    };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      totp,
      redirectTo: next,
    });
    // signIn always throws NEXT_REDIRECT on success.
    return { ok: true };
  } catch (err) {
    // Auth.js v5 throws NEXT_REDIRECT for successful redirects — re-throw.
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      typeof (err as { digest: unknown }).digest === "string" &&
      (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
    ) {
      // Successful sign-in: refund the attempt budget.
      await clearAuthAttempt({ flow: "login", identifier: email });
      throw err;
    }
    if (err instanceof AuthError) {
      const code = err.cause?.err?.message ?? err.message ?? "";
      switch (code) {
        case AUTH_ERRORS.TOTP_REQUIRED:
          return {
            ok: false,
            code,
            needsTotp: true,
            message: "Enter the 6-digit code from your authenticator app.",
          };
        case AUTH_ERRORS.TOTP_INVALID:
          return {
            ok: false,
            code,
            needsTotp: true,
            message: "That code didn't match. Try again.",
          };
        case AUTH_ERRORS.ACCOUNT_DISABLED:
          return {
            ok: false,
            code,
            message: "This account has been deactivated.",
          };
        case AUTH_ERRORS.INVALID_CREDENTIALS:
        default:
          return {
            ok: false,
            code: AUTH_ERRORS.INVALID_CREDENTIALS,
            message: "Email or password is incorrect.",
          };
      }
    }
    return {
      ok: false,
      code: "UNKNOWN",
      message: "Something went wrong. Try again in a moment.",
    };
  }
}
