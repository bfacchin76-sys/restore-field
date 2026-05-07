import "server-only";
import IORedis, { type Redis } from "ioredis";
import { env } from "@/lib/env";

let cached: Redis | null = null;

export function getRedis(): Redis {
  if (cached) return cached;
  cached = new IORedis(env.REDIS_URL, {
    // BullMQ requires this — see https://docs.bullmq.io/guide/connections
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return cached;
}
