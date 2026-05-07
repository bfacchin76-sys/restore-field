/**
 * Basic equipment-count recommendation per PRD §8.4 / §14 Phase 4.
 *
 *   - Air movers: ~1 per 50–60 sqft of affected wet floor (CAT 1) or
 *     1 per 50 sqft (CAT 2/3, more aggressive turnover).
 *   - LGR dehumidifier: roughly 1 per 1500 cu ft of containment volume,
 *     or by AHAM-rated pints per day vs. the load. We use the simpler
 *     "1 LGR per 800–1000 sqft of affected area" rule of thumb.
 *
 * This is intentionally conservative. The full IICRC S500 calculator
 * (load classes + initial humidity ratio + dehu rating) is deferred to
 * v2.
 */

import type { WaterCategory, WaterClass } from "@prisma/client";

export interface RecommendationInput {
  /** Total affected square footage across all rooms in the job. */
  affectedSqFt: number;
  /** Worst category present. */
  worstCategory?: WaterCategory | null;
  /** Worst class present. */
  worstClass?: WaterClass | null;
}

export interface Recommendation {
  airMovers: number;
  lgrDehumidifiers: number;
  airScrubbers: number;
  rationale: string;
}

const AIR_MOVER_COVERAGE_SQFT_BY_CLASS: Record<string, number> = {
  CLASS_1: 70,
  CLASS_2: 50,
  CLASS_3: 50,
  CLASS_4: 40,
};

const LGR_COVERAGE_SQFT = 900;

export function recommendEquipment(
  input: RecommendationInput,
): Recommendation {
  const sqft = Math.max(0, input.affectedSqFt);
  if (sqft === 0) {
    return {
      airMovers: 0,
      lgrDehumidifiers: 0,
      airScrubbers: 0,
      rationale: "No affected area entered yet.",
    };
  }

  const coverage =
    (input.worstClass &&
      AIR_MOVER_COVERAGE_SQFT_BY_CLASS[input.worstClass]) ??
    50;
  const airMovers = Math.max(1, Math.ceil(sqft / coverage));
  const lgrDehumidifiers = Math.max(1, Math.ceil(sqft / LGR_COVERAGE_SQFT));

  // CAT_3 / sewage water: scrubbers for IAQ during demo + drying.
  const airScrubbers = input.worstCategory === "CAT_3" ? 1 : 0;

  const parts = [
    `${sqft.toLocaleString()} sqft affected`,
    input.worstClass ? `Class ${input.worstClass.replace("CLASS_", "")}` : null,
    input.worstCategory ? `Cat ${input.worstCategory.replace("CAT_", "")}` : null,
  ].filter(Boolean) as string[];

  const rationale =
    parts.join(" · ") +
    ` → ~1 air mover per ${coverage} sqft, ~1 LGR per ${LGR_COVERAGE_SQFT} sqft` +
    (airScrubbers ? "; HEPA scrubber for CAT 3" : "");

  return { airMovers, lgrDehumidifiers, airScrubbers, rationale };
}
