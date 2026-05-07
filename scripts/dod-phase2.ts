import {
  PrismaClient,
  Prisma,
  JobStatus,
  LossType,
  WaterCategory,
  WaterClass,
} from "@prisma/client";

// Inline copies of generateJobNumber + assertCanTransition so we don't hit
// the `server-only` barrier when running this script via tsx.
async function generateJobNumber(orgId: string, client: PrismaClient): Promise<string> {
  const year = new Date().getUTCFullYear();
  const org = await client.organization.findUnique({
    where: { id: orgId },
    select: { jobNumberPrefix: true },
  });
  if (!org) throw new Error("org missing");
  const rows = await client.$queryRaw<{ nextSeq: number }[]>(Prisma.sql`
    INSERT INTO "JobNumberCounter" ("id", "organizationId", "year", "nextSeq")
    VALUES (gen_random_uuid()::text, ${orgId}, ${year}, 2)
    ON CONFLICT ("organizationId", "year") DO UPDATE SET "nextSeq" = "JobNumberCounter"."nextSeq" + 1
    RETURNING ("nextSeq" - 1) AS "nextSeq"
  `);
  return `${org.jobNumberPrefix}-${year}-${String(rows[0].nextSeq).padStart(4, "0")}`;
}

const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  DRAFT: ["ACTIVE", "ON_HOLD", "CANCELLED"],
  ACTIVE: ["DRYING", "DRAFT", "ON_HOLD", "COMPLETE", "CANCELLED"],
  DRYING: ["ACTIVE", "ON_HOLD", "COMPLETE", "CANCELLED"],
  COMPLETE: ["DRYING", "CLOSED"],
  ON_HOLD: ["ACTIVE", "DRAFT", "DRYING", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};
function assertCanTransition(from: JobStatus, to: JobStatus) {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid transition ${from} → ${to}`);
  }
}

const prisma = new PrismaClient();

async function recordAudit(
  action: string,
  userId: string | null,
  jobId: string | null,
  details: object,
) {
  await prisma.auditLog.create({
    data: { userId, jobId, action, details: details as object },
  });
}

async function main() {
  const owner = await prisma.user.findUnique({
    where: { email: "owner@example.com" },
  });
  if (!owner) throw new Error("seed first");

  // Wipe leftovers from previous DoD runs
  const leftover = await prisma.customer.findFirst({
    where: { organizationId: owner.organizationId, lastName: "DoD-Test" },
  });
  if (leftover) {
    await prisma.job.deleteMany({ where: { customerId: leftover.id } });
    await prisma.customer.delete({ where: { id: leftover.id } });
  }

  console.log("--- DoD scenario ---");

  const customer = await prisma.customer.create({
    data: {
      organizationId: owner.organizationId,
      firstName: "Phase2",
      lastName: "DoD-Test",
      addressLine1: "456 Demo Ave",
      city: "Garden City",
      state: "NY",
      postalCode: "11530",
      claimNumber: "DOD-001",
    },
  });
  await recordAudit("customer.create", owner.id, null, {
    customerId: customer.id,
  });
  console.log("customer:", customer.id);

  const jobNumber = await generateJobNumber(owner.organizationId, prisma);
  const job = await prisma.job.create({
    data: {
      organizationId: owner.organizationId,
      jobNumber,
      customerId: customer.id,
      lossType: LossType.WATER,
      status: JobStatus.DRAFT,
      createdById: owner.id,
      causeOfLoss: "Burst supply line",
      assignments: { create: { userId: owner.id, role: "lead" } },
    },
  });
  await recordAudit("job.create", owner.id, job.id, { jobNumber });
  console.log("job:", job.jobNumber, "status:", job.status);

  const rooms = [
    {
      name: "Kitchen",
      floor: "1st",
      lengthFt: 14,
      widthFt: 12,
      heightFt: 8,
      category: WaterCategory.CAT_2,
      classOfLoss: WaterClass.CLASS_2,
      affectedMaterials: ["drywall", "cabinetry", "subfloor_plywood"],
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
      affectedMaterials: ["concrete", "framing"],
    },
  ];
  for (let i = 0; i < rooms.length; i++) {
    const r = await prisma.room.create({
      data: { ...rooms[i], jobId: job.id, sortOrder: i },
    });
    await recordAudit("room.create", owner.id, job.id, {
      roomId: r.id,
      name: r.name,
    });
    console.log(" room", i + 1, ":", r.name);
  }

  const path: [JobStatus, JobStatus][] = [
    ["DRAFT", "ACTIVE"],
    ["ACTIVE", "DRYING"],
    ["DRYING", "COMPLETE"],
    ["COMPLETE", "CLOSED"],
  ];
  for (const [from, to] of path) {
    assertCanTransition(from, to);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: to,
        firstResponseAt:
          from === "DRAFT" && to === "ACTIVE" ? new Date() : undefined,
        closedAt: to === "CLOSED" ? new Date() : undefined,
      },
    });
    await recordAudit("job.status.update", owner.id, job.id, { from, to });
    console.log(" transition:", from, "→", to);
  }

  const audits = await prisma.auditLog.findMany({
    where: { jobId: job.id },
    orderBy: { createdAt: "asc" },
    select: { action: true },
  });
  console.log(
    "audit rows for this job:",
    audits.map((a) => a.action).join(", "),
  );
  console.log("JOB_ID=" + job.id);
  console.log("JOB_NUMBER=" + job.jobNumber);
  console.log("CUSTOMER_ID=" + customer.id);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
