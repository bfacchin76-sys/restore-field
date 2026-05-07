/**
 * Authorisation helper. PRD §7.
 *
 * Single `can()` entry point used in Server Actions and RSC pages.
 * Pure function — no DB, no async — so it's trivially unit-testable.
 *
 * Conventions:
 *   - actions are dotted strings ("job.create", "user.invite", ...)
 *   - the resource argument is whatever the action operates on; usually
 *     a row out of Prisma. For org-scoped actions pass an Organization
 *     (or any object with `{ id }` matching the user's organizationId).
 *   - Subcontractors only see jobs they're explicitly assigned to.
 *     Read-only public shares are checked via JobShare.token, not here.
 */
import type { Role } from "@prisma/client";

export interface ActorUser {
  id: string;
  role: Role;
  organizationId: string;
  active: boolean;
}

export interface OrgRef {
  id: string;
}

export interface JobRef {
  id: string;
  organizationId: string;
  /** Optional: ids of users explicitly assigned to the job. */
  assignedUserIds?: readonly string[];
  /** Optional: the user who created the job. */
  createdById?: string;
}

export type Action =
  | "job.create"
  | "job.view"
  | "job.update"
  | "job.delete"
  | "photo.upload"
  | "photo.delete"
  | "reading.create"
  | "report.generate"
  | "equipment.manage"
  | "user.invite"
  | "user.manage"
  | "org.settings";

const isAdmin = (u: ActorUser) =>
  u.role === "OWNER" || u.role === "OFFICE_ADMIN";
const isOwner = (u: ActorUser) => u.role === "OWNER";

function sameOrg(user: ActorUser, ref: { organizationId: string } | OrgRef): boolean {
  if ("organizationId" in ref) return ref.organizationId === user.organizationId;
  return ref.id === user.organizationId;
}

function isAssignedTo(user: ActorUser, job: JobRef): boolean {
  if (job.createdById === user.id) return true;
  return job.assignedUserIds?.includes(user.id) ?? false;
}

export function can(
  user: ActorUser | null | undefined,
  action: Action,
  resource: OrgRef | JobRef,
): boolean {
  if (!user || !user.active) return false;

  switch (action) {
    case "job.create": {
      // org-scoped: passes an OrgRef
      if (!sameOrg(user, resource)) return false;
      return ["OWNER", "OFFICE_ADMIN", "LEAD_TECH"].includes(user.role);
    }
    case "job.delete": {
      if (!sameOrg(user, resource)) return false;
      return isAdmin(user);
    }
    case "job.update": {
      const job = resource as JobRef;
      if (!sameOrg(user, job)) return false;
      if (isAdmin(user)) return true;
      if (user.role === "LEAD_TECH" || user.role === "TECH") {
        return isAssignedTo(user, job);
      }
      return false;
    }
    case "job.view": {
      const job = resource as JobRef;
      if (!sameOrg(user, job)) return false;
      if (isAdmin(user)) return true;
      if (user.role === "READ_ONLY") return false; // read-only shares go through JobShare, not here
      return isAssignedTo(user, job);
    }
    case "photo.upload":
    case "reading.create": {
      const job = resource as JobRef;
      if (!sameOrg(user, job)) return false;
      if (isAdmin(user)) return true;
      return isAssignedTo(user, job);
    }
    case "photo.delete": {
      const job = resource as JobRef;
      if (!sameOrg(user, job)) return false;
      return isAdmin(user) || user.role === "LEAD_TECH";
    }
    case "report.generate": {
      const job = resource as JobRef;
      if (!sameOrg(user, job)) return false;
      return ["OWNER", "OFFICE_ADMIN", "LEAD_TECH"].includes(user.role);
    }
    case "equipment.manage":
    case "user.invite":
    case "user.manage": {
      if (!sameOrg(user, resource)) return false;
      return isAdmin(user);
    }
    case "org.settings": {
      if (!sameOrg(user, resource)) return false;
      return isOwner(user);
    }
    default: {
      // Exhaustiveness check
      const _never: never = action;
      void _never;
      return false;
    }
  }
}

export function assertCan(
  user: ActorUser | null | undefined,
  action: Action,
  resource: OrgRef | JobRef,
): asserts user is ActorUser {
  if (!can(user, action, resource)) {
    const err = new Error(`Forbidden: ${action}`);
    (err as Error & { code?: string }).code = "FORBIDDEN";
    throw err;
  }
}
