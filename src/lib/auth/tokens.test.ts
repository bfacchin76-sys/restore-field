import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  findUsableToken,
  hashToken,
  issueVerificationToken,
  markTokenUsed,
  purgeExpiredTokens,
} from "./tokens";

const TEST_EMAIL = "tokens-test@fieldrestore.local";

beforeAll(async () => {
  await prisma.verificationToken.deleteMany({
    where: { email: TEST_EMAIL },
  });
});

afterAll(async () => {
  await prisma.verificationToken.deleteMany({
    where: { email: TEST_EMAIL },
  });
  await prisma.$disconnect();
});

describe("verification tokens", () => {
  it("issues a usable token and validates it once, then refuses re-use", async () => {
    const issued = await issueVerificationToken({
      purpose: "PASSWORD_RESET",
      email: TEST_EMAIL,
      ttlMs: 60_000,
    });

    expect(issued.rawToken).toMatch(/^[a-f0-9]{64}$/);

    // Stored only as a hash — never plain.
    const row = await prisma.verificationToken.findUnique({
      where: { id: issued.id },
    });
    expect(row?.tokenHash).toBe(hashToken(issued.rawToken));
    expect(row?.tokenHash).not.toBe(issued.rawToken);

    // Lookup with the right purpose succeeds.
    const usable = await findUsableToken(issued.rawToken, "PASSWORD_RESET");
    expect(usable?.id).toBe(issued.id);

    // Wrong purpose rejected.
    expect(await findUsableToken(issued.rawToken, "INVITE")).toBeNull();

    // Mark used → no longer usable.
    await markTokenUsed(issued.id);
    expect(await findUsableToken(issued.rawToken, "PASSWORD_RESET")).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const issued = await issueVerificationToken({
      purpose: "MAGIC_LINK",
      email: TEST_EMAIL,
      ttlMs: -1, // expired immediately
    });
    expect(await findUsableToken(issued.rawToken, "MAGIC_LINK")).toBeNull();
  });

  it("rejects malformed token strings without a DB hit", async () => {
    expect(await findUsableToken("", "PASSWORD_RESET")).toBeNull();
    expect(await findUsableToken("short", "PASSWORD_RESET")).toBeNull();
  });

  it("purgeExpiredTokens clears unused expired rows", async () => {
    const issued = await issueVerificationToken({
      purpose: "INVITE",
      email: TEST_EMAIL,
      ttlMs: -10_000,
    });
    const purged = await purgeExpiredTokens();
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.verificationToken.findUnique({ where: { id: issued.id } }),
    ).toBeNull();
  });
});
