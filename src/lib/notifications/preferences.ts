import "server-only";
import { prisma } from "@/lib/db";

/**
 * Notification preference resolution. PRD §10.
 *
 * Missing rows resolve to documented defaults so users can opt out one
 * by one — they don't need a row created up front.
 */

export interface ResolvedPreferences {
  emailJobStatusChange: boolean;
  emailJobAssigned: boolean;
  emailReportShared: boolean;
  emailWeeklyDigest: boolean;
}

export const DEFAULT_PREFERENCES: ResolvedPreferences = {
  emailJobStatusChange: true,
  emailJobAssigned: true,
  emailReportShared: false,
  emailWeeklyDigest: false,
};

export async function getPreferences(
  userId: string,
): Promise<ResolvedPreferences> {
  const row = await prisma.notificationPreference.findUnique({
    where: { userId },
  });
  if (!row) return { ...DEFAULT_PREFERENCES };
  return {
    emailJobStatusChange: row.emailJobStatusChange,
    emailJobAssigned: row.emailJobAssigned,
    emailReportShared: row.emailReportShared,
    emailWeeklyDigest: row.emailWeeklyDigest,
  };
}

export async function upsertPreferences(
  userId: string,
  prefs: Partial<ResolvedPreferences>,
): Promise<ResolvedPreferences> {
  const merged = { ...DEFAULT_PREFERENCES, ...prefs };
  const row = await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...merged },
    update: merged,
  });
  return {
    emailJobStatusChange: row.emailJobStatusChange,
    emailJobAssigned: row.emailJobAssigned,
    emailReportShared: row.emailReportShared,
    emailWeeklyDigest: row.emailWeeklyDigest,
  };
}
