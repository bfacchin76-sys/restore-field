import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Liveness + readiness probe for Caddy / docker-compose health checks.
 * Returns 200 once the app can talk to Postgres; otherwise 503.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, time: new Date().toISOString() });
  } catch {
    return NextResponse.json(
      { ok: false, error: "db unreachable" },
      { status: 503 },
    );
  }
}
