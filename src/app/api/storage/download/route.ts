import { NextResponse, type NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { Readable } from "node:stream";
import { LOCAL_STORAGE_ROOT, verifyLocalSignature } from "@/lib/storage/local";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  pdf: "application/pdf",
};

function mimeFor(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const sig = verifyLocalSignature(token, "GET");
  if (!sig) {
    return NextResponse.json(
      { error: "Invalid or expired download token" },
      { status: 403 },
    );
  }
  const path = join(LOCAL_STORAGE_ROOT, sig.k.split("/").join(sep));
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const nodeStream = createReadStream(path);
  // ReadableStream.from with type assertion — Next 16 supports node streams.
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
  return new NextResponse(webStream, {
    headers: {
      "Content-Type": mimeFor(sig.k),
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=900",
    },
  });
}
