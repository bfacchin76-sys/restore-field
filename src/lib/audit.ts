import "server-only";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export interface AuditMeta {
  /** Optional job association for filtering activity feeds. */
  jobId?: string | null;
  /** Optional structured payload (e.g. before/after diff). */
  details?: Record<string, unknown>;
}

export interface ActorContext {
  userId: string;
}

/**
 * Wraps a Server Action so that, on success, an AuditLog row is written
 * with user / IP / UA / before-after details. PRD §7.
 *
 * Use:
 *   const update = withAudit(
 *     "user.role.update",
 *     async (input) => { ... return { jobId: null, details: { ... } }; },
 *     { actor }
 *   );
 *
 * The action callback returns either:
 *   - the resolved domain value (logged with empty details), or
 *   - a tuple [value, AuditMeta] to attach extra metadata.
 */
type WithAuditResult<T> = T | readonly [T, AuditMeta];

export function withAudit<TInput, TResult>(
  action: string,
  fn: (input: TInput) => Promise<WithAuditResult<TResult>>,
  ctx: { actor: ActorContext | null | undefined },
) {
  return async (input: TInput): Promise<TResult> => {
    const out = await fn(input);
    let value: TResult;
    let meta: AuditMeta = {};
    if (Array.isArray(out) && out.length === 2 && typeof out[1] === "object") {
      value = out[0] as TResult;
      meta = out[1] as AuditMeta;
    } else {
      value = out as TResult;
    }

    let ipAddress: string | null = null;
    let userAgent: string | null = null;
    try {
      const h = await headers();
      ipAddress =
        h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        h.get("x-real-ip") ??
        null;
      userAgent = h.get("user-agent");
    } catch {
      // outside request context (tests) — fine, leave nulls
    }

    try {
      await prisma.auditLog.create({
        data: {
          userId: ctx.actor?.userId ?? null,
          jobId: meta.jobId ?? null,
          action,
          details: (meta.details ?? {}) as object,
          ipAddress,
          userAgent,
        },
      });
    } catch (err) {
      logger.warn({ err, action }, "audit log failed");
    }

    return value;
  };
}

/** Convenience: write an audit row imperatively. */
export async function recordAudit(
  action: string,
  ctx: { actor: ActorContext | null | undefined; jobId?: string | null },
  details: Record<string, unknown> = {},
): Promise<void> {
  let ipAddress: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ipAddress =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      null;
    userAgent = h.get("user-agent");
  } catch {
    /* outside request context */
  }

  try {
    await prisma.auditLog.create({
      data: {
        userId: ctx.actor?.userId ?? null,
        jobId: ctx.jobId ?? null,
        action,
        details: details as object,
        ipAddress,
        userAgent,
      },
    });
  } catch (err) {
    logger.warn({ err, action }, "audit log failed");
  }
}
