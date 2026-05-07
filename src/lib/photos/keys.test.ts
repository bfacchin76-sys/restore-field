import { describe, expect, it } from "vitest";
import {
  extFromMime,
  isImageMime,
  mediumKey,
  originalKey,
  photoPrefix,
  thumbKey,
  tmpKey,
} from "./keys";

describe("photo storage keys", () => {
  it("photoPrefix joins org/job/photo", () => {
    expect(photoPrefix("org_a", "job_b", "p_1")).toBe(
      "orgs/org_a/jobs/job_b/photos/p_1",
    );
  });

  it("originalKey includes the canonical extension", () => {
    expect(originalKey("o", "j", "p", "JPG")).toBe(
      "orgs/o/jobs/j/photos/p/original.jpg",
    );
    expect(originalKey("o", "j", "p", "heic")).toBe(
      "orgs/o/jobs/j/photos/p/original.heic",
    );
  });

  it("thumbKey and mediumKey use webp", () => {
    expect(thumbKey("o", "j", "p")).toBe("orgs/o/jobs/j/photos/p/thumb.webp");
    expect(mediumKey("o", "j", "p")).toBe("orgs/o/jobs/j/photos/p/medium.webp");
  });

  it("tmpKey rejects unsupported extensions", () => {
    expect(tmpKey("p_1", "jpg")).toBe("tmp/p_1.jpg");
    expect(() => tmpKey("p_1", "exe")).toThrow();
  });

  it("extFromMime maps common image MIMEs", () => {
    expect(extFromMime("image/jpeg")).toBe("jpg");
    expect(extFromMime("image/png")).toBe("png");
    expect(extFromMime("image/heic")).toBe("heic");
    expect(extFromMime("image/heif")).toBe("heif");
    expect(extFromMime("image/webp")).toBe("webp");
  });

  it("isImageMime accepts the supported set, rejects others", () => {
    expect(isImageMime("image/jpeg")).toBe(true);
    expect(isImageMime("image/heic")).toBe(true);
    expect(isImageMime("application/pdf")).toBe(false);
    expect(isImageMime("text/plain")).toBe(false);
  });
});
