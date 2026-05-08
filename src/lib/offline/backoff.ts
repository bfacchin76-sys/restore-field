/**
 * Exponential-backoff schedule for the sync queue.
 *
 *   attempt 0 → retry in 5 s
 *   attempt 1 → 30 s
 *   attempt 2 → 5 m
 *   attempt 3 → 30 m
 *   attempt 4 → 1 h
 *   attempt 5 → 6 h
 *   attempt 6 → 12 h
 *   attempt 7+ → STUCK (per PRD §9 — 24 h budget surfaces stuck items)
 */

export const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

const SCHEDULE_MS: number[] = [
  5_000,
  30_000,
  5 * 60_000,
  30 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
];

export function nextDelayMs(attempt: number): number {
  if (attempt < 0) return SCHEDULE_MS[0];
  if (attempt >= SCHEDULE_MS.length) return SCHEDULE_MS[SCHEDULE_MS.length - 1];
  return SCHEDULE_MS[attempt];
}

/**
 * Cumulative wall-clock cost of having retried `attempt` times. After the
 * schedule is exhausted, each further retry incurs the cap delay (12 h),
 * so attempt 8 crosses the 24 h budget and `shouldGiveUp` flips.
 */
export function totalElapsedFor(attempt: number): number {
  if (attempt <= 0) return 0;
  let s = 0;
  for (let i = 0; i < Math.min(attempt, SCHEDULE_MS.length); i++) {
    s += SCHEDULE_MS[i];
  }
  if (attempt > SCHEDULE_MS.length) {
    s += (attempt - SCHEDULE_MS.length) * SCHEDULE_MS[SCHEDULE_MS.length - 1];
  }
  return s;
}

export function shouldGiveUp(attempt: number): boolean {
  return totalElapsedFor(attempt) >= STUCK_AFTER_MS;
}
