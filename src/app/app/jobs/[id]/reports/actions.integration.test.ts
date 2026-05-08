/**
 * Integration tests for the report Server Actions (audit L4). Mocks
 * the auth session, queue, mailer, and audit calls so we can drive
 * real Postgres state changes without standing up Redis or the
 * NextAuth handler.
 *
 * Coverage:
 *   - regenerateReport clears `processingError` + `processingAttempts`
 *     and re-enqueues. Asserts the M3+M4 reset shape.
 *   - regenerateReport rejects unauthenticated callers + wrong-org
 *     callers (RBAC isolation).
 *   - emailReport refuses to issue a JobShare while pdfStorageKey is
 *     still null (the M4 "still generating" path).
 *   - emailReport issues exactly one JobShare with the right scope
 *     and calls the mailer once on the happy path.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { LossType, ReportType, Role } from "@prisma/client";
import { prisma } from "@/lib/db";

// vi.mock is hoisted, so referenced variables must come from
// vi.hoisted to be in scope at mock-eval time.
const { sessionUser, queueAdd, sendMailMock } = vi.hoisted(() => ({
  sessionUser: { id: "", role: "OWNER", organizationId: "", active: true },
  queueAdd: vi.fn<(name: string, payload: { reportId: string }) => Promise<void>>(
    async () => undefined,
  ),
  sendMailMock: vi.fn<
    (input: { to: string; subject: string; text: string }) => Promise<{
      messageId: string;
    }>
  >(async () => ({ messageId: "stub" })),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(async () => sessionUser),
}));

vi.mock("@/lib/queue/queues", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queue/queues")>(
    "@/lib/queue/queues",
  );
  return {
    ...actual,
    getReportGenerateQueue: () => ({ add: queueAdd }),
  };
});

vi.mock("@/lib/mailer", () => ({
  sendMail: sendMailMock,
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { emailReport, regenerateReport } from "./actions";

const SLUG = "phase-l4-report-actions";

let orgId: string;
let otherOrgId: string;
let userId: string;
let outsideUserId: string;
let jobId: string;
let reportId: string;
let customerId: string;

beforeAll(async () => {
  // Wipe any leftover state from a prior crashed run.
  for (const slug of [SLUG, `${SLUG}-other`]) {
    const o = await prisma.organization.findUnique({ where: { slug } });
    if (o) await cleanup(o.id);
  }

  const org = await prisma.organization.create({
    data: { name: "L4 Test Org", slug: SLUG, jobNumberPrefix: "L4" },
  });
  orgId = org.id;

  const otherOrg = await prisma.organization.create({
    data: { name: "L4 Other Org", slug: `${SLUG}-other`, jobNumberPrefix: "L4O" },
  });
  otherOrgId = otherOrg.id;

  const user = await prisma.user.create({
    data: {
      email: `${SLUG}-owner@local`,
      name: "L4 Owner",
      role: Role.OWNER,
      active: true,
      organizationId: orgId,
      passwordHash: "$2b$12$placeholder",
    },
  });
  userId = user.id;

  const outsider = await prisma.user.create({
    data: {
      email: `${SLUG}-outsider@local`,
      name: "L4 Outsider",
      role: Role.OWNER,
      active: true,
      organizationId: otherOrgId,
      passwordHash: "$2b$12$placeholder",
    },
  });
  outsideUserId = outsider.id;

  const customer = await prisma.customer.create({
    data: {
      organizationId: orgId,
      firstName: "Test",
      lastName: "Customer",
      addressLine1: "1 Main St",
      city: "Anytown",
      state: "NY",
      postalCode: "10000",
    },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await cleanup(orgId);
  await cleanup(otherOrgId);
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Fresh job + report for each test so state doesn't leak.
  const job = await prisma.job.create({
    data: {
      organizationId: orgId,
      jobNumber: `L4-${Date.now()}`,
      lossType: LossType.WATER,
      customerId,
      createdById: userId,
    },
  });
  jobId = job.id;

  const report = await prisma.report.create({
    data: {
      jobId,
      type: ReportType.WATER_MITIGATION,
      pdfStorageKey: null,
      // Worker would normally fill these on first failure; we set
      // them up-front so we can verify the reset.
      processingError: "render exploded",
      processingAttempts: 3,
      dataSnapshot: {},
      config: {},
      generatedById: userId,
    },
  });
  reportId = report.id;

  sessionUser.id = userId;
  sessionUser.organizationId = orgId;
  sessionUser.active = true;
  sessionUser.role = Role.OWNER;
  queueAdd.mockClear();
  sendMailMock.mockClear();
});

afterEach(async () => {
  await prisma.jobShare.deleteMany({ where: { job: { organizationId: orgId } } });
  await prisma.report.deleteMany({ where: { job: { organizationId: orgId } } });
  await prisma.job.deleteMany({ where: { organizationId: orgId } });
});

describe("regenerateReport (audit L4)", () => {
  it("rejects when unauthenticated", async () => {
    const session = await import("@/lib/auth/session");
    vi.mocked(session.getSessionUser).mockResolvedValueOnce(null);

    const r = await regenerateReport({ reportId });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Not signed in/i);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("rejects when actor is in a different org (assertCan throws)", async () => {
    sessionUser.id = outsideUserId;
    sessionUser.organizationId = otherOrgId;

    await expect(regenerateReport({ reportId })).rejects.toThrow();
    expect(queueAdd).not.toHaveBeenCalled();

    // Report row left untouched — still has its prior failure state.
    const after = await prisma.report.findUniqueOrThrow({
      where: { id: reportId },
    });
    expect(after.processingError).toBe("render exploded");
    expect(after.processingAttempts).toBe(3);
    expect(after.pdfStorageKey).toBeNull();
  });

  it("clears processingError + processingAttempts and re-enqueues on success", async () => {
    const r = await regenerateReport({ reportId });
    expect(r.ok).toBe(true);
    expect(r.reportId).toBe(reportId);

    const after = await prisma.report.findUniqueOrThrow({
      where: { id: reportId },
    });
    // Audit M4: regenerate resets the error path so a re-tried
    // render starts fresh.
    expect(after.processingError).toBeNull();
    expect(after.processingAttempts).toBe(0);
    expect(after.pdfStorageKey).toBeNull();
    expect(after.generatedById).toBe(userId);

    expect(queueAdd).toHaveBeenCalledTimes(1);
    const [name, payload] = queueAdd.mock.calls[0];
    expect(name).toBe("report");
    expect(payload).toEqual({ reportId });
  });
});

describe("emailReport (audit L4)", () => {
  it("returns 'still generating' when pdfStorageKey is null", async () => {
    const r = await emailReport({
      reportId,
      recipientEmail: "adjuster@example.com",
      expiresInDays: 7,
    });

    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/still generating/i);
    expect(sendMailMock).not.toHaveBeenCalled();

    // No JobShare written on the unhappy path.
    const shares = await prisma.jobShare.count({ where: { jobId } });
    expect(shares).toBe(0);
  });

  it("issues a single-report JobShare and sends mail on the happy path", async () => {
    // Pretend the worker has finished — stamp a key.
    await prisma.report.update({
      where: { id: reportId },
      data: { pdfStorageKey: `reports/${orgId}/${jobId}/${reportId}.pdf` },
    });

    const r = await emailReport({
      reportId,
      recipientEmail: "adjuster@example.com",
      message: "FYI",
      expiresInDays: 7,
    });

    expect(r.ok).toBe(true);
    expect(r.shareUrl).toMatch(/\/share\/[0-9a-f]{64}$/);

    const shares = await prisma.jobShare.findMany({ where: { jobId } });
    expect(shares).toHaveLength(1);
    const [share] = shares;
    expect(share.recipientEmail).toBe("adjuster@example.com");
    expect(share.revoked).toBe(false);
    // Permissions blob locks scope to this single report.
    expect(share.permissions).toEqual({ reportId });
    // Token in the share row matches the token in the URL we returned.
    expect(r.shareUrl).toContain(share.token);

    // Expiry is ~7 days out (allow 5s of slop).
    const dt = share.expiresAt.getTime() - Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(dt - sevenDaysMs)).toBeLessThan(5000);

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mailArg = sendMailMock.mock.calls[0]?.[0];
    if (!mailArg) throw new Error("mailer was not called with an argument");
    expect(mailArg.to).toBe("adjuster@example.com");
    expect(mailArg.subject).toMatch(/Restoration report/);
    expect(mailArg.text).toContain(share.token);
    expect(mailArg.text).toContain("FYI");
  });

  it("rejects when actor is in a different org", async () => {
    await prisma.report.update({
      where: { id: reportId },
      data: { pdfStorageKey: "reports/x/y/z.pdf" },
    });
    sessionUser.id = outsideUserId;
    sessionUser.organizationId = otherOrgId;

    await expect(
      emailReport({
        reportId,
        recipientEmail: "adjuster@example.com",
        expiresInDays: 7,
      }),
    ).rejects.toThrow();

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(await prisma.jobShare.count({ where: { jobId } })).toBe(0);
  });
});

async function cleanup(id: string) {
  await prisma.auditLog.deleteMany({
    where: { user: { organizationId: id } },
  });
  await prisma.jobShare.deleteMany({
    where: { job: { organizationId: id } },
  });
  await prisma.report.deleteMany({
    where: { job: { organizationId: id } },
  });
  await prisma.job.deleteMany({ where: { organizationId: id } });
  await prisma.jobNumberCounter.deleteMany({ where: { organizationId: id } });
  await prisma.user.deleteMany({ where: { organizationId: id } });
  await prisma.customer.deleteMany({ where: { organizationId: id } });
  await prisma.organization.delete({ where: { id } }).catch(() => {
    /* already gone */
  });
}
