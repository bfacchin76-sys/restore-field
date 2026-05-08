"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { upsertPreferences } from "@/lib/notifications/preferences";

const input = z.object({
  emailJobStatusChange: z.boolean(),
  emailJobAssigned: z.boolean(),
  emailReportShared: z.boolean(),
  emailWeeklyDigest: z.boolean(),
});

export async function updateNotificationPreferences(
  data: z.infer<typeof input>,
): Promise<{ ok: boolean; message?: string }> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };
  const parsed = input.parse(data);
  await upsertPreferences(actor.id, parsed);
  revalidatePath("/app/account");
  return { ok: true };
}
