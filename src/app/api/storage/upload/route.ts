import { NextResponse, type NextRequest } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { LOCAL_STORAGE_ROOT, verifyLocalSignature } from "@/lib/storage/local";

// Local-storage adapter only — in production with MinIO/R2 the browser
// PUTs directly to the S3 endpoint.

export async function PUT(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const sig = verifyLocalSignature(token, "PUT");
  if (!sig) {
    return NextResponse.json(
      { error: "Invalid or expired upload token" },
      { status: 403 },
    );
  }
  const ct = request.headers.get("content-type") ?? "";
  if (sig.c && sig.c !== ct) {
    return NextResponse.json(
      { error: `Content-Type mismatch (expected ${sig.c})` },
      { status: 415 },
    );
  }
  const buf = Buffer.from(await request.arrayBuffer());
  const target = join(LOCAL_STORAGE_ROOT, sig.k.split("/").join(sep));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buf);
  return NextResponse.json({ ok: true, bytes: buf.byteLength });
}
