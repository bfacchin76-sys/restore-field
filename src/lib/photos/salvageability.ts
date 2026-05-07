import type { Salvageability } from "@prisma/client";

/**
 * Auto-classify rules for fire jobs (PRD §8.2):
 *
 *   - Soft goods / fabric items   → UNSALVAGEABLE
 *   - Hard surfaces warped/burned → UNSALVAGEABLE
 *   - Electronics                 → REQUIRES_PROFESSIONAL_CLEANING
 *   - All other intact hard surfaces → SALVAGEABLE
 *
 * Inputs come from the user-assigned tags + caption — no AI yet.
 * Returns null if we can't classify confidently (caller should leave
 * the existing rating, often PENDING_REVIEW, alone).
 */
export type Classification = Salvageability | null;

const SOFT_GOOD_TAGS = new Set([
  "fabric",
  "soft",
  "softgood",
  "soft-good",
  "upholstery",
  "clothing",
  "carpet",
  "rug",
  "curtain",
  "drape",
  "linens",
  "mattress",
  "pillow",
  "stuffed-animal",
]);

const ELECTRONICS_TAGS = new Set([
  "electronics",
  "electronic",
  "tv",
  "television",
  "computer",
  "laptop",
  "desktop",
  "monitor",
  "stereo",
  "speaker",
  "appliance",
  "microwave",
  "fridge",
  "refrigerator",
  "phone",
  "tablet",
  "console",
  "gaming",
]);

const DAMAGE_TAGS = new Set([
  "burned",
  "burnt",
  "warped",
  "melted",
  "charred",
  "scorched",
  "destroyed",
  "unsalvageable",
]);

function normalise(tag: string): string {
  return tag.toLowerCase().replace(/\s+/g, "-").replace(/_/g, "-");
}

export function classifyByTags(
  tags: readonly string[],
  caption?: string | null,
): Classification {
  const normTags = tags.map(normalise);
  const haystack = [...normTags, ...(caption ? [normalise(caption)] : [])];

  const hasAny = (set: Set<string>) =>
    haystack.some((t) =>
      [...set].some((token) => t === token || t.includes(token)),
    );

  if (hasAny(DAMAGE_TAGS)) return "UNSALVAGEABLE";
  if (hasAny(SOFT_GOOD_TAGS)) return "UNSALVAGEABLE";
  if (hasAny(ELECTRONICS_TAGS)) return "REQUIRES_PROFESSIONAL_CLEANING";
  if (normTags.length > 0) return "SALVAGEABLE";
  return null;
}
