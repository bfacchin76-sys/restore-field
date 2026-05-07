"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUserFresh } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { issueVerificationToken } from "@/lib/auth/tokens";
import { issueSubcontractorMagicLink } from "@/lib/auth/magic-link";
import { recordAudit } from "@/lib/audit";
import { sendMail } from "@/lib/mailer";
import { inviteEmail } from "@/lib/auth/email-templates";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1, "Name is required"),
  role: z.nativeEnum(Role),
});

export interface InviteResult {
  ok: boolean;
  message?: string;
}

export async function inviteUser(
  _prev: InviteResult,
  formData: FormData,
): Promise<InviteResult> {
  const actor = await getSessionUserFresh();
  if (!actor) return { ok: false, message: "Not signed in." };

  assertCan(actor, "user.invite", { id: actor.organizationId });

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check your inputs.",
    };
  }

  // Owners can grant any role; OFFICE_ADMIN cannot grant OWNER.
  if (parsed.data.role === "OWNER" && actor.role !== "OWNER") {
    return { ok: false, message: "Only an Owner can invite another Owner." };
  }

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
  if (existing) {
    return { ok: false, message: "A user with that email already exists." };
  }

  const org = await prisma.organization.findUnique({
    where: { id: actor.organizationId },
    select: { name: true },
  });
  if (!org) return { ok: false, message: "Organization not found." };

  const { rawToken } = await issueVerificationToken({
    purpose: "INVITE",
    email: parsed.data.email,
    organizationId: actor.organizationId,
    ttlMs: SEVEN_DAYS_MS,
    payload: {
      role: parsed.data.role,
      name: parsed.data.name,
      invitedById: actor.id,
    },
  });

  const tpl = inviteEmail(org.name, rawToken);
  await sendMail({ to: parsed.data.email, ...tpl });

  await recordAudit("user.invite", {
    actor: { userId: actor.id },
    jobId: null,
  }, {
    invitedEmail: parsed.data.email,
    role: parsed.data.role,
  });

  revalidatePath("/app/admin/users");
  return {
    ok: true,
    message: `Invite sent to ${parsed.data.email}. Link valid for 7 days.`,
  };
}

const updateRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.nativeEnum(Role),
});

export async function updateUserRole(input: z.infer<typeof updateRoleSchema>) {
  const actor = await getSessionUserFresh();
  if (!actor) throw new Error("Not signed in");
  assertCan(actor, "user.manage", { id: actor.organizationId });

  const { userId, role } = updateRoleSchema.parse(input);
  if (userId === actor.id && role !== actor.role) {
    throw new Error("You can't change your own role.");
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, organizationId: true, role: true, email: true },
  });
  if (!target || target.organizationId !== actor.organizationId) {
    throw new Error("User not found");
  }

  // Only OWNER can promote to or demote from OWNER.
  if (
    (target.role === "OWNER" || role === "OWNER") &&
    actor.role !== "OWNER"
  ) {
    throw new Error("Only an Owner can manage other Owners.");
  }

  await prisma.user.update({ where: { id: userId }, data: { role } });

  await recordAudit("user.role.update", {
    actor: { userId: actor.id },
    jobId: null,
  }, {
    targetUserId: userId,
    targetEmail: target.email,
    from: target.role,
    to: role,
  });

  revalidatePath("/app/admin/users");
}

const setActiveSchema = z.object({
  userId: z.string().min(1),
  active: z.boolean(),
});

export async function setUserActive(input: z.infer<typeof setActiveSchema>) {
  const actor = await getSessionUserFresh();
  if (!actor) throw new Error("Not signed in");
  assertCan(actor, "user.manage", { id: actor.organizationId });

  const { userId, active } = setActiveSchema.parse(input);
  if (userId === actor.id) {
    throw new Error("You can't deactivate your own account.");
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, organizationId: true, role: true, email: true },
  });
  if (!target || target.organizationId !== actor.organizationId) {
    throw new Error("User not found");
  }
  if (target.role === "OWNER" && actor.role !== "OWNER") {
    throw new Error("Only an Owner can deactivate another Owner.");
  }

  await prisma.user.update({ where: { id: userId }, data: { active } });

  await recordAudit(
    active ? "user.activate" : "user.deactivate",
    { actor: { userId: actor.id }, jobId: null },
    { targetUserId: userId, targetEmail: target.email },
  );

  revalidatePath("/app/admin/users");
}

const subInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1),
});

export interface SubLinkResult {
  ok: boolean;
  message?: string;
}

export async function inviteSubcontractor(
  _prev: SubLinkResult,
  formData: FormData,
): Promise<SubLinkResult> {
  const actor = await getSessionUserFresh();
  if (!actor) return { ok: false, message: "Not signed in." };
  assertCan(actor, "user.invite", { id: actor.organizationId });

  const parsed = subInviteSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check your inputs.",
    };
  }

  try {
    await issueSubcontractorMagicLink({
      email: parsed.data.email,
      name: parsed.data.name,
      organizationId: actor.organizationId,
    });
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Failed to send link.",
    };
  }

  await recordAudit("user.subcontractor.invite", {
    actor: { userId: actor.id },
    jobId: null,
  }, { email: parsed.data.email });

  revalidatePath("/app/admin/users");
  return {
    ok: true,
    message: `Magic link sent to ${parsed.data.email}. Valid for 7 days.`,
  };
}
