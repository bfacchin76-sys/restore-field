/**
 * Job status state machine. PRD §14 Phase 2.
 *
 *   DRAFT → ACTIVE → DRYING → COMPLETE → CLOSED
 *
 * Side states:
 *   ON_HOLD   — reachable from ACTIVE / DRYING; resumes back to where it came
 *   CANCELLED — terminal, reachable from DRAFT / ACTIVE / ON_HOLD
 *
 * The machine is intentionally permissive in *backwards* transitions among
 * the active flow (e.g. ACTIVE → DRAFT) — restoration jobs sometimes
 * surface new info that demotes status. We forbid transitions out of
 * terminal states (CLOSED, CANCELLED).
 */
import type { JobStatus } from "@prisma/client";

const VALID_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  DRAFT: ["ACTIVE", "ON_HOLD", "CANCELLED"],
  ACTIVE: ["DRYING", "DRAFT", "ON_HOLD", "COMPLETE", "CANCELLED"],
  DRYING: ["ACTIVE", "ON_HOLD", "COMPLETE", "CANCELLED"],
  COMPLETE: ["DRYING", "CLOSED"],
  ON_HOLD: ["ACTIVE", "DRAFT", "DRYING", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransition(
  from: JobStatus,
  to: JobStatus,
): boolean {
  if (from === to) return false;
  return VALID_TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: JobStatus): JobStatus[] {
  return VALID_TRANSITIONS[from];
}

export class InvalidJobStatusTransition extends Error {
  constructor(public from: JobStatus, public to: JobStatus) {
    super(`Invalid job status transition: ${from} → ${to}`);
  }
}

export function assertCanTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidJobStatusTransition(from, to);
  }
}

/**
 * For UI affordances. Returns labels for outgoing transitions, in the
 * order the field user is most likely to want.
 */
export function transitionLabel(from: JobStatus, to: JobStatus): string {
  if (from === "DRAFT" && to === "ACTIVE") return "Start job";
  if (from === "ACTIVE" && to === "DRYING") return "Begin drying";
  if (from === "DRYING" && to === "ACTIVE") return "Resume mitigation";
  if (from === "DRYING" && to === "COMPLETE") return "Mark complete";
  if (from === "ACTIVE" && to === "COMPLETE") return "Mark complete";
  if (from === "COMPLETE" && to === "CLOSED") return "Close job";
  if (to === "ON_HOLD") return "Place on hold";
  if (to === "CANCELLED") return "Cancel job";
  if (from === "ON_HOLD") return `Resume (${to.replace("_", " ").toLowerCase()})`;
  return `→ ${to.replace("_", " ").toLowerCase()}`;
}
