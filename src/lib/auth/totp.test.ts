import { describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { generateTotpSetup, verifyTotp } from "./totp";

describe("TOTP", () => {
  it("generates a working secret + otpauth URL", async () => {
    const setup = await generateTotpSetup("user@example.com", "RestoreField");
    expect(setup.secret).toMatch(/^[A-Z2-7]+$/);
    expect(setup.otpauthUrl).toContain("otpauth://totp/");
    expect(setup.otpauthUrl).toContain(encodeURIComponent("RestoreField"));
    expect(setup.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("verifies the current code from a known secret", () => {
    const secret = authenticator.generateSecret();
    const code = authenticator.generate(secret);
    expect(verifyTotp(code, secret)).toBe(true);
  });

  it("rejects malformed codes", () => {
    const secret = authenticator.generateSecret();
    expect(verifyTotp("", secret)).toBe(false);
    expect(verifyTotp("abc", secret)).toBe(false);
    expect(verifyTotp("12345", secret)).toBe(false);
    expect(verifyTotp("1234567", secret)).toBe(false);
  });

  it("rejects codes from a different secret", () => {
    const a = authenticator.generateSecret();
    const b = authenticator.generateSecret();
    const codeForA = authenticator.generate(a);
    expect(verifyTotp(codeForA, b)).toBe(false);
  });
});
