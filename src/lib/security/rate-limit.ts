import "server-only";
import { headers } from "next/headers";
import { getRedis } from "@/lib/queue/connection";
import { logger } from "@/lib/logger";

/**
 * Redis-backed sliding-window rate limiter. PRD §11 task 1.
 *
 * One sorted set per `key`, scored by epoch-ms. We trim entries
 * older than the window on every check, so the set never grows
 * unbounded even for hot keys.
 *
 * Use:
 *   const decision = await checkRateLimit({
 *     key: `login:${email}`,
 *     windowMs: 15 * 60_000,
 *     max: 5,
 *   });
 *   if (!decision.ok) throw new RateLimitedError(decision.retryAfterSeconds);
 *
 * Soft-fail: if Redis is unreachable we *allow* the request rather
 * than locking everyone out. The error is logged so operators can
 * page on it via Uptime Kuma's log probe (Phase 11 follow-up).
 */

export interface RateLimitInput {
  /** Stable key for this counter, e.g. `login:user@example.com` or `ip:1.2.3.4`. */
  key: string;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max events permitted within the window. */
  max: number;
}

export interface RateLimitDecision {
  ok: boolean;
  /** Number of remaining attempts in the current window. */
  remaining: number;
  /** Seconds until the oldest in-window event ages out (when `ok === false`). */
  retryAfterSeconds: number;
}

export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, key: string) {
    super(
      `Rate limit exceeded for ${key}. Try again in ${retryAfterSeconds}s.`,
    );
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function checkRateLimit(
  input: RateLimitInput,
): Promise<RateLimitDecision> {
  const { key, windowMs, max } = input;
  const now = Date.now();
  const cutoff = now - windowMs;
  const redisKey = `rl:${key}`;

  try {
    const redis = getRedis();
    // Pipeline: drop old entries, push the new tick, count, set TTL.
    // The new entry is recorded *before* we check the count so that two
    // concurrent calls see consistent ordering — we then roll it back
    // when the limit is exceeded so genuine over-limit calls don't keep
    // ratcheting the window.
    const tick = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    const pipeline = redis.multi();
    pipeline.zremrangebyscore(redisKey, 0, cutoff);
    pipeline.zadd(redisKey, now, tick);
    pipeline.zcard(redisKey);
    pipeline.pexpire(redisKey, windowMs);
    const result = await pipeline.exec();
    if (!result) throw new Error("redis pipeline returned null");
    const count = Number(result[2][1] ?? 0);

    if (count <= max) {
      return { ok: true, remaining: max - count, retryAfterSeconds: 0 };
    }

    // Over-limit — undo this tick so the same key isn't punished forever.
    await redis.zrem(redisKey, tick);
    const oldest = await redis.zrange(redisKey, 0, 0, "WITHSCORES");
    const oldestScore = oldest.length >= 2 ? Number(oldest[1]) : now;
    const retryAfterMs = Math.max(0, oldestScore + windowMs - now);
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    return { ok: false, remaining: 0, retryAfterSeconds };
  } catch (err) {
    logger.warn({ err, key }, "rate-limiter unavailable — allowing request");
    return { ok: true, remaining: max, retryAfterSeconds: 0 };
  }
}

export async function clearRateLimit(key: string): Promise<void> {
  try {
    await getRedis().del(`rl:${key}`);
  } catch (err) {
    logger.warn({ err, key }, "rate-limiter clear failed");
  }
}

/**
 * Best-effort client IP. Audit H6: take the *rightmost* `TRUSTED_PROXY_HOPS`
 * entry of XFF (default 1: Caddy is the only proxy). If a misconfigured
 * upstream PREPENDS attacker-supplied XFF, the rightmost entry is still
 * the value our trusted proxy stamped, not the spoof.
 *
 * In our docker-compose deployment Caddy's `header_up X-Forwarded-For
 * {remote_host}` overwrites XFF with the immediate peer, so a single
 * value is the norm. This logic is the belt-and-braces in case the app
 * gets fronted by something else.
 */
export async function clientIp(): Promise<string> {
  try {
    const hops = Math.max(
      1,
      Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "1", 10) || 1,
    );
    const h = await headers();
    const xff = h.get("x-forwarded-for");
    if (xff) {
      const parts = xff
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length > 0) {
        const idx = Math.max(0, parts.length - hops);
        return parts[idx]!;
      }
    }
    const xri = h.get("x-real-ip");
    if (xri) return xri.trim();
  } catch {
    // outside request scope (tests / scripts) — fine
  }
  return "unknown";
}
