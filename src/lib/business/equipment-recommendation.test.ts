import { describe, expect, it } from "vitest";
import { recommendEquipment } from "./equipment-recommendation";

describe("recommendEquipment", () => {
  it("returns zero everything for 0 sqft", () => {
    const r = recommendEquipment({ affectedSqFt: 0 });
    expect(r.airMovers).toBe(0);
    expect(r.lgrDehumidifiers).toBe(0);
    expect(r.airScrubbers).toBe(0);
  });

  it("CLASS_2 → 1 air mover per ~50 sqft", () => {
    const r = recommendEquipment({ affectedSqFt: 200, worstClass: "CLASS_2" });
    expect(r.airMovers).toBe(4);
  });

  it("CLASS_4 (deep saturation) needs more air movers", () => {
    const r = recommendEquipment({ affectedSqFt: 200, worstClass: "CLASS_4" });
    expect(r.airMovers).toBe(5);
  });

  it("at least one LGR per job, even small ones", () => {
    const r = recommendEquipment({ affectedSqFt: 50 });
    expect(r.lgrDehumidifiers).toBeGreaterThanOrEqual(1);
  });

  it("scales LGRs at ~1 per 900 sqft", () => {
    const r = recommendEquipment({ affectedSqFt: 1800 });
    expect(r.lgrDehumidifiers).toBe(2);
  });

  it("CAT_3 adds an air scrubber", () => {
    const a = recommendEquipment({ affectedSqFt: 200, worstCategory: "CAT_3" });
    const b = recommendEquipment({ affectedSqFt: 200, worstCategory: "CAT_2" });
    expect(a.airScrubbers).toBe(1);
    expect(b.airScrubbers).toBe(0);
  });

  it("rationale references the inputs", () => {
    const r = recommendEquipment({
      affectedSqFt: 600,
      worstClass: "CLASS_2",
      worstCategory: "CAT_2",
    });
    expect(r.rationale).toContain("600");
    expect(r.rationale).toContain("Class 2");
    expect(r.rationale).toContain("Cat 2");
  });
});
