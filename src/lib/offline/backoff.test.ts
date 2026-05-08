import { describe, expect, it } from "vitest";
import {
  STUCK_AFTER_MS,
  nextDelayMs,
  shouldGiveUp,
  totalElapsedFor,
} from "./backoff";

describe("backoff", () => {
  it("starts at 5 s and never drops below it", () => {
    expect(nextDelayMs(0)).toBe(5_000);
    expect(nextDelayMs(-3)).toBe(5_000);
  });

  it("monotonically grows up to the cap", () => {
    let prev = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      const d = nextDelayMs(attempt);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });

  it("caps at the longest entry past the schedule", () => {
    const cap = nextDelayMs(6);
    for (let attempt = 7; attempt < 20; attempt++) {
      expect(nextDelayMs(attempt)).toBe(cap);
    }
  });

  it("totalElapsedFor accumulates", () => {
    expect(totalElapsedFor(0)).toBe(0);
    expect(totalElapsedFor(1)).toBe(5_000);
    expect(totalElapsedFor(2)).toBe(5_000 + 30_000);
  });

  it("STUCK_AFTER_MS is 24 h per PRD §9", () => {
    expect(STUCK_AFTER_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("shouldGiveUp flips once cumulative retries exceed 24 h", () => {
    expect(shouldGiveUp(0)).toBe(false);
    expect(shouldGiveUp(3)).toBe(false);
    // After 7 attempts the cumulative wait is 5s + 30s + 5m + 30m + 1h + 6h + 12h
    // = ~19.6 h, still under 24 h
    expect(shouldGiveUp(7)).toBe(false);
    // attempt 8 brings the running total to ~31.6 h ⇒ stuck
    expect(shouldGiveUp(8)).toBe(true);
  });
});
