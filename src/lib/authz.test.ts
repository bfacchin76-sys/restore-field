import { describe, expect, it } from "vitest";
import { can, type ActorUser, type JobRef } from "./authz";

const ORG_ID = "org_1";
const OTHER_ORG = "org_2";

function user(role: ActorUser["role"], overrides: Partial<ActorUser> = {}): ActorUser {
  return {
    id: "u_self",
    role,
    organizationId: ORG_ID,
    active: true,
    ...overrides,
  };
}

const orgRef = { id: ORG_ID };
const otherOrgRef = { id: OTHER_ORG };

const job = (overrides: Partial<JobRef> = {}): JobRef => ({
  id: "j_1",
  organizationId: ORG_ID,
  assignedUserIds: [],
  createdById: "u_creator",
  ...overrides,
});

describe("can()", () => {
  it("rejects null and inactive users for everything", () => {
    expect(can(null, "job.view", job())).toBe(false);
    expect(can(undefined, "job.view", job())).toBe(false);
    expect(can(user("OWNER", { active: false }), "job.view", job())).toBe(false);
  });

  it("rejects cross-organization access entirely", () => {
    const owner = user("OWNER");
    expect(can(owner, "job.view", job({ organizationId: OTHER_ORG }))).toBe(false);
    expect(can(owner, "org.settings", otherOrgRef)).toBe(false);
  });

  describe("job.create", () => {
    it("allows OWNER, OFFICE_ADMIN, LEAD_TECH", () => {
      expect(can(user("OWNER"), "job.create", orgRef)).toBe(true);
      expect(can(user("OFFICE_ADMIN"), "job.create", orgRef)).toBe(true);
      expect(can(user("LEAD_TECH"), "job.create", orgRef)).toBe(true);
    });
    it("denies TECH, SUBCONTRACTOR, READ_ONLY", () => {
      expect(can(user("TECH"), "job.create", orgRef)).toBe(false);
      expect(can(user("SUBCONTRACTOR"), "job.create", orgRef)).toBe(false);
      expect(can(user("READ_ONLY"), "job.create", orgRef)).toBe(false);
    });
  });

  describe("job.delete", () => {
    it("allows OWNER and OFFICE_ADMIN only", () => {
      expect(can(user("OWNER"), "job.delete", orgRef)).toBe(true);
      expect(can(user("OFFICE_ADMIN"), "job.delete", orgRef)).toBe(true);
      expect(can(user("LEAD_TECH"), "job.delete", orgRef)).toBe(false);
      expect(can(user("TECH"), "job.delete", orgRef)).toBe(false);
    });
  });

  describe("job.view", () => {
    it("admins see all jobs in their org", () => {
      expect(can(user("OWNER"), "job.view", job())).toBe(true);
      expect(can(user("OFFICE_ADMIN"), "job.view", job())).toBe(true);
    });
    it("techs see only assigned jobs", () => {
      const u = user("TECH", { id: "u_tech" });
      expect(can(u, "job.view", job({ assignedUserIds: ["u_tech"] }))).toBe(true);
      expect(can(u, "job.view", job({ assignedUserIds: ["u_other"] }))).toBe(false);
    });
    it("subcontractors only see their assigned jobs", () => {
      const u = user("SUBCONTRACTOR", { id: "u_sub" });
      expect(can(u, "job.view", job({ assignedUserIds: ["u_sub"] }))).toBe(true);
      expect(can(u, "job.view", job({ assignedUserIds: [] }))).toBe(false);
    });
    it("read-only users get nothing through can() (use JobShare)", () => {
      const u = user("READ_ONLY", { id: "u_ro" });
      expect(can(u, "job.view", job({ assignedUserIds: ["u_ro"] }))).toBe(false);
    });
    it("creator can always view their own job", () => {
      const u = user("TECH", { id: "u_tech" });
      expect(can(u, "job.view", job({ createdById: "u_tech", assignedUserIds: [] }))).toBe(true);
    });
  });

  describe("photo.upload / reading.create", () => {
    it("allows admins regardless of assignment", () => {
      expect(can(user("OWNER"), "photo.upload", job())).toBe(true);
      expect(can(user("OFFICE_ADMIN"), "reading.create", job())).toBe(true);
    });
    it("requires assignment for techs and subcontractors", () => {
      const u = user("TECH", { id: "u_tech" });
      expect(can(u, "photo.upload", job({ assignedUserIds: ["u_tech"] }))).toBe(true);
      expect(can(u, "photo.upload", job({ assignedUserIds: [], createdById: "x" }))).toBe(false);
    });
  });

  describe("user.invite / user.manage / equipment.manage", () => {
    it("admins only", () => {
      expect(can(user("OWNER"), "user.invite", orgRef)).toBe(true);
      expect(can(user("OFFICE_ADMIN"), "user.manage", orgRef)).toBe(true);
      expect(can(user("OFFICE_ADMIN"), "equipment.manage", orgRef)).toBe(true);
      expect(can(user("LEAD_TECH"), "user.invite", orgRef)).toBe(false);
      expect(can(user("TECH"), "user.manage", orgRef)).toBe(false);
    });
  });

  describe("org.settings", () => {
    it("OWNER only", () => {
      expect(can(user("OWNER"), "org.settings", orgRef)).toBe(true);
      expect(can(user("OFFICE_ADMIN"), "org.settings", orgRef)).toBe(false);
    });
  });
});
