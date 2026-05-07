import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwords";

describe("password hashing", () => {
  it("verifies a correctly hashed password", async () => {
    const hash = await hashPassword("super-secret-123");
    expect(hash).not.toBe("super-secret-123");
    expect(await verifyPassword("super-secret-123", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("super-secret-123");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("returns false for null/empty hash", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", undefined)).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
  });

  it("uses a per-call salt — two hashes of the same password differ", async () => {
    const a = await hashPassword("hello");
    const b = await hashPassword("hello");
    expect(a).not.toBe(b);
    expect(await verifyPassword("hello", a)).toBe(true);
    expect(await verifyPassword("hello", b)).toBe(true);
  });
});
