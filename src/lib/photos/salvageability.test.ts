import { describe, expect, it } from "vitest";
import { classifyByTags } from "./salvageability";

describe("classifyByTags (fire job auto-classify)", () => {
  it("returns null when there are no tags", () => {
    expect(classifyByTags([])).toBeNull();
  });

  it("burned/warped surfaces → UNSALVAGEABLE", () => {
    expect(classifyByTags(["wooden bookshelf", "warped"])).toBe("UNSALVAGEABLE");
    expect(classifyByTags(["dresser", "burned"])).toBe("UNSALVAGEABLE");
    expect(classifyByTags(["melted"])).toBe("UNSALVAGEABLE");
  });

  it("soft goods → UNSALVAGEABLE", () => {
    expect(classifyByTags(["sofa", "upholstery"])).toBe("UNSALVAGEABLE");
    expect(classifyByTags(["mattress"])).toBe("UNSALVAGEABLE");
    expect(classifyByTags(["clothing"])).toBe("UNSALVAGEABLE");
    expect(classifyByTags(["carpet"])).toBe("UNSALVAGEABLE");
  });

  it("electronics → REQUIRES_PROFESSIONAL_CLEANING", () => {
    expect(classifyByTags(["tv"])).toBe("REQUIRES_PROFESSIONAL_CLEANING");
    expect(classifyByTags(["laptop"])).toBe("REQUIRES_PROFESSIONAL_CLEANING");
    expect(classifyByTags(["microwave"])).toBe("REQUIRES_PROFESSIONAL_CLEANING");
  });

  it("intact hard surface tags → SALVAGEABLE", () => {
    expect(classifyByTags(["coffee-table"])).toBe("SALVAGEABLE");
    expect(classifyByTags(["lamp", "metal"])).toBe("SALVAGEABLE");
  });

  it("damage signal beats soft goods (more conservative)", () => {
    // burned mattress → UNSALVAGEABLE (matches both rules; either way correct)
    expect(classifyByTags(["mattress", "burned"])).toBe("UNSALVAGEABLE");
  });

  it("electronics with damage flips to UNSALVAGEABLE (damage rule first)", () => {
    expect(classifyByTags(["tv", "destroyed"])).toBe("UNSALVAGEABLE");
  });

  it("caption text feeds classifier too", () => {
    expect(classifyByTags(["wood-bookshelf"], "Burned through")).toBe(
      "UNSALVAGEABLE",
    );
  });

  it("normalises hyphen / underscore / case", () => {
    expect(classifyByTags(["Stuffed_Animal"])).toBe("UNSALVAGEABLE");
    expect(classifyByTags(["Soft Good"])).toBe("UNSALVAGEABLE");
  });
});
