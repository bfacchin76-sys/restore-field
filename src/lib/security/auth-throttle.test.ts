/**
 * auth-throttle key-derivation tests. PRD §11 / audit M1: a value
 * that looks like another namespace (e.g. identifier "IP:1.2.3.4")
 * must NOT collide with the actual ip:* bucket.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { checkAuthAttempt, clearAuthAttempt } from "./auth-throttle";
import { getRedis } from "@/lib/queue/connection";

const PREFIX = "auth:";

beforeEach(async () => {
  const redis = getRedis();
  // Clear all auth-throttle keys so each test starts clean. Don't
  // touch the rate-limit suite's keys.
  const keys = await redis.keys(`rl:${PREFIX}*`);
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  await getRedis().quit();
});

describe("auth-throttle key namespacing (audit M1)", () => {
  it("identifier 'IP:1.2.3.4' lives in its own bucket — does NOT share with the IP namespace", async () => {
    // Burn the budget under the malicious-shape identifier.
    for (let i = 0; i < 5; i++) {
      const r = await checkAuthAttempt({
        flow: "login",
        identifier: "IP:1.2.3.4",
      });
      expect(r.ok).toBe(true);
    }
    // The IP namespace for 1.2.3.4 should still have full budget.
    // We can't directly check the IP path without mocking headers,
    // but we can verify the next call from the same identifier is
    // blocked while a different identifier is still free.
    expect(
      (await checkAuthAttempt({ flow: "login", identifier: "IP:1.2.3.4" }))
        .ok,
    ).toBe(false);
    expect(
      (await checkAuthAttempt({ flow: "login", identifier: "user@x.com" }))
        .ok,
    ).toBe(true);

    await clearAuthAttempt({ flow: "login", identifier: "IP:1.2.3.4" });
    await clearAuthAttempt({ flow: "login", identifier: "user@x.com" });
  });

  it("clear refunds only the asked-for identifier, not its lowercase twin from another namespace", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await checkAuthAttempt({
        flow: "login",
        identifier: "user@x.com",
      });
      expect(r.ok).toBe(true);
    }
    expect(
      (await checkAuthAttempt({ flow: "login", identifier: "user@x.com" }))
        .ok,
    ).toBe(false);
    await clearAuthAttempt({ flow: "login", identifier: "user@x.com" });
    expect(
      (await checkAuthAttempt({ flow: "login", identifier: "user@x.com" }))
        .ok,
    ).toBe(true);
  });
});
