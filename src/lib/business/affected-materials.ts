/** Allowed values for `Room.affectedMaterials` (JSON array). */
export const AFFECTED_MATERIALS = [
  "drywall",
  "plaster",
  "framing",
  "hardwood",
  "engineered_wood",
  "laminate",
  "carpet",
  "carpet_pad",
  "subfloor_osb",
  "subfloor_plywood",
  "tile",
  "concrete",
  "insulation",
  "cabinetry",
  "ceiling",
  "trim_baseboard",
] as const;

export type AffectedMaterial = (typeof AFFECTED_MATERIALS)[number];

export function isAffectedMaterial(v: string): v is AffectedMaterial {
  return (AFFECTED_MATERIALS as readonly string[]).includes(v);
}

export function affectedMaterialLabel(m: string): string {
  return m
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
