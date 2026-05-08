/**
 * Offline queue types — mirror the Server Action input shapes so the
 * sync layer can replay items without rewriting them.
 */

import type {
  Material,
  MeterType,
  Salvageability,
  ScaleType,
} from "@prisma/client";

export type QueueStatus = "queued" | "syncing" | "synced" | "stuck";

export interface BaseQueueItem {
  id?: number; // auto-increment primary key
  status: QueueStatus;
  retryCount: number;
  /** ms since epoch — when we'll next try syncing this. */
  nextAttemptAt: number;
  lastError?: string | null;
  createdAt: number;
  /** Set once status transitions to `synced`; informational only. */
  syncedAt?: number | null;
}

export interface QueuedPhoto extends BaseQueueItem {
  jobId: string;
  roomId: string | null;
  filename: string;
  mimeType: string;
  size: number;
  blob: Blob;
  caption: string | null;
  tags: string[];
  salvageability: Salvageability | null;
}

export interface QueuedReading extends BaseQueueItem {
  jobId: string;
  roomId: string | null;
  surface: string;
  material: Material;
  meterType: MeterType;
  scaleType: ScaleType;
  moistureValue: number;
  ambientTempF: number | null;
  ambientRH: number | null;
  isDryGoal: boolean;
  isInitial: boolean;
  notes: string | null;
}

export interface QueuedNote extends BaseQueueItem {
  jobId: string;
  content: string;
}

export interface CachedJobSummary {
  jobId: string;
  organizationId: string;
  /** Snapshot blob — opaque to the cache, used for offline rendering. */
  payload: unknown;
  fetchedAt: number;
}
