"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

const settingsInput = z.object({
  salesTaxRate: z.number().finite().min(0).max(1),
  overheadProfitRate: z.number().finite().min(0).max(1),
  licenseNumber: z
    .string()
    .trim()
    .max(80)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null)),
  reportFooter: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export interface OrgSettingsResult {
  ok: boolean;
  message?: string;
}

export async function updateOrgSettings(
  input: z.infer<typeof settingsInput>,
): Promise<OrgSettingsResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };

  assertCan(actor, "org.settings", { id: actor.organizationId });

  const data = settingsInput.parse(input);

  const before = await prisma.organization.findUniqueOrThrow({
    where: { id: actor.organizationId },
    select: {
      salesTaxRate: true,
      overheadProfitRate: true,
      licenseNumber: true,
      reportFooter: true,
    },
  });

  await prisma.organization.update({
    where: { id: actor.organizationId },
    data,
  });

  await recordAudit(
    "org.settings.update",
    { actor: { userId: actor.id } },
    { before, after: data },
  );

  revalidatePath("/app/admin/org");
  return { ok: true };
}
