/**
 * Rate-limit unit tests. Hits the real Redis in `.env.local`. PRD §11.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, clearRateLimit } from "./rate-limit";
import { getRedis } from "@/lib/queue/connection";

const TEST_KEY_PREFIX = "test-rl";

beforeEach(async () => {
  // Clear keys this suite owns so re-runs are clean.
  const redis = getRedis();
  const keys = await redis.keys(`rl:${TEST_KEY_PREFIX}*`);
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  const redis = getRedis();
  const keys = await redis.keys(`rl:${TEST_KEY_PREFIX}*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
});

describe("checkRateLimit", () => {
  it("allows up to `max` calls then blocks the next one", async () => {
    const key = `${TEST_KEY_PREFIX}:basic`;
    const cfg = { key, windowMs: 60_000, max: 3 };
    expect((await checkRateLimit(cfg)).ok).toBe(true);
    expect((await checkRateLimit(cfg)).ok).toBe(true);
    expect((await checkRateLimit(cfg)).ok).toBe(true);
    const blocked = await checkRateLimit(cfg);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("clearRateLimit resets the counter", async () => {
    const key = `${TEST_KEY_PREFIX}:reset`;
    const cfg = { key, windowMs: 60_000, max: 1 };
    expect((await checkRateLimit(cfg)).ok).toBe(true);
    expect((await checkRateLimit(cfg)).ok).toBe(false);
    await clearRateLimit(key);
    expect((await checkRateLimit(cfg)).ok).toBe(true);
  });

  it("returns remaining attempts in the current window", async () => {
    const key = `${TEST_KEY_PREFIX}:remaining`;
    const cfg = { key, windowMs: 60_000, max: 5 };
    expect((await checkRateLimit(cfg)).remaining).toBe(4);
    expect((await checkRateLimit(cfg)).remaining).toBe(3);
    expect((await checkRateLimit(cfg)).remaining).toBe(2);
  });

  it("isolates by key — separate keys don't share counters", async () => {
    const a = `${TEST_KEY_PREFIX}:keyA`;
    const b = `${TEST_KEY_PREFIX}:keyB`;
    const cfg = { windowMs: 60_000, max: 1 };
    expect((await checkRateLimit({ key: a, ...cfg })).ok).toBe(true);
    expect((await checkRateLimit({ key: a, ...cfg })).ok).toBe(false);
    expect((await checkRateLimit({ key: b, ...cfg })).ok).toBe(true);
  });

  it("lets new tickets in once the window slides past old ones", async () => {
    const key = `${TEST_KEY_PREFIX}:window`;
    const cfg = { key, windowMs: 200, max: 2 };
    expect((await checkRateLimit(cfg)).ok).toBe(true);
    expect((await checkRateLimit(cfg)).ok).toBe(true);
    expect((await checkRateLimit(cfg)).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 250));
    expect((await checkRateLimit(cfg)).ok).toBe(true);
  });
});
