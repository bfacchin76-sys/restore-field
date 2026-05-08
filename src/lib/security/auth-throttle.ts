import "server-only";
import { checkRateLimit, clearRateLimit, clientIp } from "./rate-limit";

/**
 * Auth-flow throttling helpers. PRD §11 tasks 1 + 2.
 *
 * Two rolling windows guard each sensitive endpoint:
 *   - identifier-keyed (email): 5 attempts / 15 minutes
 *   - ip-keyed:                10 attempts / 15 minutes (more lenient
 *                               because legit users behind a NAT share
 *                               a single IP, but stricter than nothing)
 *
 * Successful authentication calls `clearAuthAttempt()` so a slow user
 * isn't locked out by their own typos.
 */

const AUTH_WINDOW_MS = 15 * 60_000;
const PER_IDENTIFIER_MAX = 5;
const PER_IP_MAX = 10;

/**
 * Slightly tighter limits for "send me an email" flows so an attacker
 * can't spam the SMTP server with magic-link requests for a victim's
 * mailbox.
 */
const EMAIL_SEND_WINDOW_MS = 60 * 60_000;
const EMAIL_SEND_MAX = 5;

export type AuthFlow =
  | "login"
  | "password-reset-request"
  | "password-reset-confirm"
  | "magic-link-request";

interface CheckResult {
  ok: boolean;
  retryAfterSeconds: number;
}

/**
 * Build a Redis key for a (flow, namespace, value) tuple. We lowercase
 * the *value* only — never the namespace prefix — so `identifier:
 * "IP:1.2.3.4"` can't collide with the `ip:` namespace bucket
 * (audit M1).
 */
function key(flow: AuthFlow, ns: "id" | "ip", value: string): string {
  return `auth:${flow}:${ns}:${value.toLowerCase()}`;
}

/**
 * Run before consuming the credential. Returns `ok: false` and a
 * retry-after hint when the caller should bail out.
 */
export async function checkAuthAttempt(input: {
  flow: AuthFlow;
  identifier: string;
}): Promise<CheckResult> {
  const ip = await clientIp();
  const isEmailSend =
    input.flow === "password-reset-request" ||
    input.flow === "magic-link-request";

  const idDecision = await checkRateLimit({
    key: key(input.flow, "id", input.identifier),
    windowMs: isEmailSend ? EMAIL_SEND_WINDOW_MS : AUTH_WINDOW_MS,
    max: isEmailSend ? EMAIL_SEND_MAX : PER_IDENTIFIER_MAX,
  });
  if (!idDecision.ok) {
    return { ok: false, retryAfterSeconds: idDecision.retryAfterSeconds };
  }

  const ipDecision = await checkRateLimit({
    key: key(input.flow, "ip", ip),
    windowMs: AUTH_WINDOW_MS,
    max: PER_IP_MAX,
  });
  if (!ipDecision.ok) {
    return { ok: false, retryAfterSeconds: ipDecision.retryAfterSeconds };
  }

  return { ok: true, retryAfterSeconds: 0 };
}

/** Successful flow — let the user back to a fresh budget. */
export async function clearAuthAttempt(input: {
  flow: AuthFlow;
  identifier: string;
}): Promise<void> {
  await clearRateLimit(key(input.flow, "id", input.identifier));
}
