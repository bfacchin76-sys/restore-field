/**
 * Concurrency test for job-number generator. Hits a real Postgres so that
 * the ON CONFLICT … RETURNING semantics get exercised.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { formatJobNumber, generateJobNumber } from "./job-number";

const SLUG = "jobnum-test-org";

let orgId: string;

beforeAll(async () => {
  // Wipe any prior run
  const existing = await prisma.organization.findUnique({ where: { slug: SLUG } });
  if (existing) {
    await prisma.jobNumberCounter.deleteMany({
      where: { organizationId: existing.id },
    });
    // Cascade deletion isn't on Organization → User; clean those up.
    await prisma.user.deleteMany({ where: { organizationId: existing.id } });
    await prisma.equipment.deleteMany({
      where: { organizationId: existing.id },
    });
    await prisma.formTemplate.deleteMany({
      where: { organizationId: existing.id },
    });
    await prisma.organization.delete({ where: { id: existing.id } });
  }
  const org = await prisma.organization.create({
    data: { name: "JobNum Test", slug: SLUG, jobNumberPrefix: "TST" },
  });
  orgId = org.id;
});

afterAll(async () => {
  await prisma.jobNumberCounter.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe("generateJobNumber", () => {
  it("formats correctly", () => {
    expect(formatJobNumber("1800WD", 2026, 7)).toBe("1800WD-2026-0007");
    expect(formatJobNumber("1800WD", 2026, 142)).toBe("1800WD-2026-0142");
    expect(formatJobNumber("1800WD", 2026, 1)).toBe("1800WD-2026-0001");
  });

  it("generates a sequential number", async () => {
    const a = await generateJobNumber(orgId, prisma, new Date("2030-01-15Z"));
    const b = await generateJobNumber(orgId, prisma, new Date("2030-02-20Z"));
    const c = await generateJobNumber(orgId, prisma, new Date("2030-03-10Z"));
    expect(a).toBe("TST-2030-0001");
    expect(b).toBe("TST-2030-0002");
    expect(c).toBe("TST-2030-0003");
  });

  it("starts a new sequence when the year rolls over", async () => {
    const newYear = await generateJobNumber(orgId, prisma, new Date("2031-01-01Z"));
    expect(newYear).toBe("TST-2031-0001");
  });

  it("100 concurrent allocations produce 100 unique numbers", async () => {
    const orgs = await prisma.organization.create({
      data: { name: "JobNum Conc", slug: "jobnum-conc-test", jobNumberPrefix: "CON" },
    });
    try {
      const now = new Date("2032-06-15Z");
      const promises = Array.from({ length: 100 }, () =>
        generateJobNumber(orgs.id, prisma, now),
      );
      const results = await Promise.all(promises);
      const unique = new Set(results);
      expect(unique.size).toBe(100);
      // Sequence covers 1..100
      const seqs = results.map((r) => Number(r.split("-")[2])).sort((a, b) => a - b);
      expect(seqs[0]).toBe(1);
      expect(seqs[99]).toBe(100);
    } finally {
      await prisma.jobNumberCounter.deleteMany({ where: { organizationId: orgs.id } });
      await prisma.organization.delete({ where: { id: orgs.id } });
    }
  });
});
