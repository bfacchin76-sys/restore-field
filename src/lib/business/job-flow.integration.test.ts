/**
 * Phase 2 DoD walkthrough as an integration test against real Postgres:
 *   - create a customer
 *   - create a job (auto-generated job number)
 *   - add three rooms with materials/category/class
 *   - reorder them
 *   - run a sequence of status transitions (DRAFT → ACTIVE → DRYING →
 *     COMPLETE → CLOSED) and assert that each writes an AuditLog row
 *   - assert that an invalid transition (CLOSED → ACTIVE) is rejected
 *
 * The Server Actions read the session via `auth()`, so this test calls
 * the underlying Prisma operations directly with the same constraints
 * (state-machine + audit). It mirrors what the actions do, not the HTTP
 * round-trip.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  JobStatus,
  LossType,
  Role,
  WaterCategory,
  WaterClass,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { generateJobNumber } from "./job-number";
import { assertCanTransition, canTransition } from "./job-status";

const TEST_SLUG = "phase2-flow-test";

let orgId: string;
let userId: string;

beforeAll(async () => {
  const existing = await prisma.organization.findUnique({
    where: { slug: TEST_SLUG },
  });
  if (existing) {
    await cleanupOrg(existing.id);
  }
  const org = await prisma.organization.create({
    data: { name: "Phase 2 Test Org", slug: TEST_SLUG, jobNumberPrefix: "P2" },
  });
  orgId = org.id;
  const u = await prisma.user.create({
    data: {
      email: `${TEST_SLUG}-owner@local`,
      name: "Phase2 Owner",
      role: Role.OWNER,
      active: true,
      organizationId: org.id,
      passwordHash: "$2b$12$placeholder",
    },
  });
  userId = u.id;
});

afterAll(async () => {
  await cleanupOrg(orgId);
  await prisma.$disconnect();
});

async function cleanupOrg(id: string) {
  // Order matters: jobs/audit must go before users (FK on createdBy/userId).
  // Cascade rules already drop rooms / assignments / audit-with-jobId on
  // job delete; we still need to drop audit rows that point only at users.
  await prisma.auditLog.deleteMany({
    where: { user: { organizationId: id } },
  });
  await prisma.job.deleteMany({ where: { organizationId: id } });
  await prisma.jobNumberCounter.deleteMany({ where: { organizationId: id } });
  await prisma.user.deleteMany({ where: { organizationId: id } });
  await prisma.customer.deleteMany({ where: { organizationId: id } });
  await prisma.organization.delete({ where: { id } });
}

describe("Phase 2 — customer + job + rooms + status flow", () => {
  it("walks DoD path end-to-end and writes audit rows for every mutation", async () => {
    // 1. Create customer
    const customer = await prisma.customer.create({
      data: {
        organizationId: orgId,
        firstName: "Sample",
        lastName: "Homeowner",
        addressLine1: "123 Main St",
        city: "Mineola",
        state: "NY",
        postalCode: "11501",
        claimNumber: "CL-1234",
      },
    });
    await prisma.auditLog.create({
      data: {
        userId,
        action: "customer.create",
        details: { customerId: customer.id },
      },
    });

    // 2. Create job with auto-generated number
    const jobNumber = await generateJobNumber(
      orgId,
      prisma,
      new Date("2026-04-15Z"),
    );
    expect(jobNumber).toBe("P2-2026-0001");

    const job = await prisma.job.create({
      data: {
        organizationId: orgId,
        jobNumber,
        customerId: customer.id,
        lossType: LossType.WATER,
        status: JobStatus.DRAFT,
        createdById: userId,
        causeOfLoss: "Supply line burst under kitchen sink",
        assignments: { create: { userId, role: "lead" } },
      },
    });
    await prisma.auditLog.create({
      data: {
        userId,
        jobId: job.id,
        action: "job.create",
        details: { jobNumber: job.jobNumber },
      },
    });

    // 3. Three rooms, each with materials + cat/class
    const roomData = [
      {
        name: "Kitchen",
        floor: "1st",
        lengthFt: 14,
        widthFt: 12,
        heightFt: 8,
        category: WaterCategory.CAT_2,
        classOfLoss: WaterClass.CLASS_2,
        affectedMaterials: ["drywall", "subfloor_plywood", "cabinetry"],
      },
      {
        name: "Living Room",
        floor: "1st",
        lengthFt: 18,
        widthFt: 14,
        heightFt: 8,
        category: WaterCategory.CAT_2,
        classOfLoss: WaterClass.CLASS_2,
        affectedMaterials: ["drywall", "carpet", "carpet_pad"],
      },
      {
        name: "Basement Storage",
        floor: "Basement",
        lengthFt: 10,
        widthFt: 8,
        heightFt: 7,
        category: WaterCategory.CAT_3,
        classOfLoss: WaterClass.CLASS_3,
        affectedMaterials: ["drywall", "concrete", "framing"],
      },
    ];

    const rooms: { id: string; name: string }[] = [];
    for (let i = 0; i < roomData.length; i++) {
      const r = roomData[i];
      const created = await prisma.room.create({
        data: { ...r, jobId: job.id, sortOrder: i },
      });
      rooms.push({ id: created.id, name: created.name });
      await prisma.auditLog.create({
        data: {
          userId,
          jobId: job.id,
          action: "room.create",
          details: { roomId: created.id, name: created.name },
        },
      });
    }
    expect(rooms).toHaveLength(3);

    // 4. Reorder: move Basement to top
    const reordered = [rooms[2].id, rooms[0].id, rooms[1].id];
    await prisma.$transaction(
      reordered.map((id, idx) =>
        prisma.room.update({ where: { id }, data: { sortOrder: idx } }),
      ),
    );
    await prisma.auditLog.create({
      data: {
        userId,
        jobId: job.id,
        action: "room.reorder",
        details: { count: reordered.length },
      },
    });

    const fetched = await prisma.room.findMany({
      where: { jobId: job.id },
      orderBy: { sortOrder: "asc" },
      select: { id: true, sortOrder: true },
    });
    expect(fetched.map((r) => r.id)).toEqual(reordered);

    // 5. Status transitions
    const transitionPath: Array<[JobStatus, JobStatus]> = [
      [JobStatus.DRAFT, JobStatus.ACTIVE],
      [JobStatus.ACTIVE, JobStatus.DRYING],
      [JobStatus.DRYING, JobStatus.COMPLETE],
      [JobStatus.COMPLETE, JobStatus.CLOSED],
    ];

    for (const [from, to] of transitionPath) {
      assertCanTransition(from, to);
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: to,
          firstResponseAt:
            from === JobStatus.DRAFT && to === JobStatus.ACTIVE
              ? new Date()
              : undefined,
          closedAt: to === JobStatus.CLOSED ? new Date() : undefined,
        },
      });
      await prisma.auditLog.create({
        data: {
          userId,
          jobId: job.id,
          action: "job.status.update",
          details: { from, to },
        },
      });
    }

    const final = await prisma.job.findUnique({
      where: { id: job.id },
      select: { status: true, firstResponseAt: true, closedAt: true },
    });
    expect(final?.status).toBe("CLOSED");
    expect(final?.firstResponseAt).not.toBeNull();
    expect(final?.closedAt).not.toBeNull();

    // 6. Reject invalid transition out of CLOSED
    expect(canTransition("CLOSED", "ACTIVE")).toBe(false);
    expect(() => assertCanTransition("CLOSED", "ACTIVE")).toThrow();

    // 7. Audit log shape — at least: customer.create, job.create, 3 room.create,
    //    room.reorder, 4 status transitions = 10 rows
    const audits = await prisma.auditLog.findMany({
      where: { userId },
      select: { action: true },
    });
    const counts = audits.reduce<Record<string, number>>((acc, r) => {
      acc[r.action] = (acc[r.action] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts["customer.create"]).toBe(1);
    expect(counts["job.create"]).toBe(1);
    expect(counts["room.create"]).toBe(3);
    expect(counts["room.reorder"]).toBe(1);
    expect(counts["job.status.update"]).toBe(4);
  });
});
