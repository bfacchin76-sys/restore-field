import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let TMP: string;

beforeAll(async () => {
  TMP = await mkdtemp(join(tmpdir(), "rf-storage-"));
  process.env.LOCAL_STORAGE_DIR = TMP;
  await mkdir(TMP, { recursive: true });
});

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("LocalStorage adapter", () => {
  it("roundtrips bytes through put/get/copy/delete and signs URLs", async () => {
    // Re-import inside the test so LOCAL_STORAGE_DIR env is read fresh.
    const mod = await import("./local");
    const { LocalStorage, verifyLocalSignature } = mod;
    const storage = new LocalStorage();

    const bytes = Buffer.from("hello world", "utf8");
    await storage.putObjectBytes("foo/bar.txt", bytes, "text/plain");
    expect(await storage.exists("foo/bar.txt")).toBe(true);
    const back = await storage.getObjectBytes("foo/bar.txt");
    expect(back.toString()).toBe("hello world");

    await storage.copyObject("foo/bar.txt", "baz/bar.txt");
    expect(await storage.exists("foo/bar.txt")).toBe(false);
    expect(await storage.exists("baz/bar.txt")).toBe(true);

    const actor = { userId: "user-1", organizationId: "org-1" };
    const put = await storage.presignedPut({
      key: "uploads/x.jpg",
      contentType: "image/jpeg",
      ttlSeconds: 60,
      actor,
    });
    expect(put.url).toContain("/api/storage/upload?token=");
    const token = new URL(put.url).searchParams.get("token") ?? "";
    const sig = verifyLocalSignature(token, "PUT");
    expect(sig?.k).toBe("uploads/x.jpg");
    expect(sig?.c).toBe("image/jpeg");
    expect(sig?.u).toBe("user-1");
    expect(sig?.o).toBe("org-1");

    const get = await storage.presignedGet({
      key: "baz/bar.txt",
      ttlSeconds: 60,
      actor,
    });
    expect(get.url).toContain("/api/storage/download?token=");
    const dlToken = new URL(get.url).searchParams.get("token") ?? "";
    expect(verifyLocalSignature(dlToken, "GET")?.k).toBe("baz/bar.txt");

    // Wrong method rejected
    expect(verifyLocalSignature(dlToken, "PUT")).toBeNull();

    await storage.deleteObject("baz/bar.txt");
    expect(await storage.exists("baz/bar.txt")).toBe(false);
  });

  it("rejects path traversal in keys", async () => {
    const { LocalStorage } = await import("./local");
    const storage = new LocalStorage();
    await expect(
      storage.putObjectBytes("../etc/passwd", Buffer.from("nope"), "text/plain"),
    ).rejects.toThrow(/Invalid storage key/);
  });

  it("requires actor on presigned URLs (audit H5 — actor binding)", async () => {
    const { LocalStorage } = await import("./local");
    const storage = new LocalStorage();
    await expect(
      storage.presignedPut({
        key: "no-actor.jpg",
        contentType: "image/jpeg",
        ttlSeconds: 60,
      }),
    ).rejects.toThrow(/actor/);
    await expect(
      storage.presignedGet({ key: "no-actor.jpg", ttlSeconds: 60 }),
    ).rejects.toThrow(/actor/);
  });
});
