import { describe, expect, it } from "vitest";
import {
  assertCanTransition,
  canTransition,
  InvalidJobStatusTransition,
  nextStatuses,
} from "./job-status";

describe("job status state machine", () => {
  it("happy path DRAFT → ACTIVE → DRYING → COMPLETE → CLOSED", () => {
    expect(canTransition("DRAFT", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "DRYING")).toBe(true);
    expect(canTransition("DRYING", "COMPLETE")).toBe(true);
    expect(canTransition("COMPLETE", "CLOSED")).toBe(true);
  });

  it("ACTIVE may also go straight to COMPLETE (no drying needed)", () => {
    expect(canTransition("ACTIVE", "COMPLETE")).toBe(true);
  });

  it("ON_HOLD reachable from active flow and resumable", () => {
    expect(canTransition("ACTIVE", "ON_HOLD")).toBe(true);
    expect(canTransition("DRYING", "ON_HOLD")).toBe(true);
    expect(canTransition("ON_HOLD", "ACTIVE")).toBe(true);
    expect(canTransition("ON_HOLD", "DRYING")).toBe(true);
  });

  it("CLOSED and CANCELLED are terminal", () => {
    for (const t of ["DRAFT", "ACTIVE", "DRYING", "COMPLETE", "ON_HOLD", "CANCELLED", "CLOSED"] as const) {
      expect(canTransition("CLOSED", t)).toBe(false);
      expect(canTransition("CANCELLED", t)).toBe(false);
    }
  });

  it("forbids self-transitions", () => {
    expect(canTransition("ACTIVE", "ACTIVE")).toBe(false);
    expect(canTransition("DRAFT", "DRAFT")).toBe(false);
  });

  it("CLOSED requires going through COMPLETE", () => {
    expect(canTransition("DRAFT", "CLOSED")).toBe(false);
    expect(canTransition("ACTIVE", "CLOSED")).toBe(false);
    expect(canTransition("DRYING", "CLOSED")).toBe(false);
    expect(canTransition("ON_HOLD", "CLOSED")).toBe(false);
  });

  it("CANCELLED is reachable from any non-terminal pre-completion state", () => {
    expect(canTransition("DRAFT", "CANCELLED")).toBe(true);
    expect(canTransition("ACTIVE", "CANCELLED")).toBe(true);
    expect(canTransition("DRYING", "CANCELLED")).toBe(true);
    expect(canTransition("ON_HOLD", "CANCELLED")).toBe(true);
    // Once a job is COMPLETE you can't cancel; you close.
    expect(canTransition("COMPLETE", "CANCELLED")).toBe(false);
  });

  it("assertCanTransition throws on invalid", () => {
    expect(() => assertCanTransition("CLOSED", "ACTIVE")).toThrow(
      InvalidJobStatusTransition,
    );
    expect(() => assertCanTransition("DRAFT", "ACTIVE")).not.toThrow();
  });

  it("nextStatuses excludes the current status", () => {
    for (const s of ["DRAFT", "ACTIVE", "DRYING", "COMPLETE", "ON_HOLD"] as const) {
      expect(nextStatuses(s)).not.toContain(s);
    }
  });
});
