"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { EquipmentStatus, EquipmentType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { parseEquipmentCsv } from "@/lib/business/equipment";

const createSchema = z.object({
  assetTag: z.string().trim().min(1).max(40),
  type: z.nativeEnum(EquipmentType),
  manufacturer: z.string().trim().max(80).nullable().optional(),
  model: z.string().trim().max(80).nullable().optional(),
  serialNumber: z.string().trim().max(80).nullable().optional(),
  amperage: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().nullable().optional(),
  ),
  cfm: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().nullable().optional(),
  ),
  ppd: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().nullable().optional(),
  ),
  status: z.nativeEnum(EquipmentStatus).default(EquipmentStatus.AVAILABLE),
  notes: z.string().trim().max(500).nullable().optional(),
});

export interface EquipmentActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

function readForm(formData: FormData) {
  const o: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    o[k] = typeof v === "string" && v.trim() === "" ? undefined : v;
  }
  return o;
}

export async function createEquipment(
  _prev: EquipmentActionResult,
  formData: FormData,
): Promise<EquipmentActionResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };
  assertCan(actor, "equipment.manage", { id: actor.organizationId });

  const parsed = createSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path.join(".") || "_form";
      if (!fe[k]) fe[k] = issue.message;
    }
    return { ok: false, fieldErrors: fe };
  }
  const d = parsed.data;
  try {
    const eq = await prisma.equipment.create({
      data: {
        organizationId: actor.organizationId,
        assetTag: d.assetTag,
        type: d.type,
        manufacturer: d.manufacturer ?? null,
        model: d.model ?? null,
        serialNumber: d.serialNumber ?? null,
        amperage: d.amperage ?? null,
        cfm: d.cfm ?? null,
        ppd: d.ppd ?? null,
        status: d.status,
        notes: d.notes ?? null,
      },
    });
    await recordAudit("equipment.create", { actor: { userId: actor.id }, jobId: null }, {
      equipmentId: eq.id,
      assetTag: eq.assetTag,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, message: `Asset tag "${d.assetTag}" already exists.` };
    }
    throw err;
  }
  revalidatePath("/app/equipment");
  return { ok: true, message: "Saved." };
}

const updateSchema = createSchema.extend({
  equipmentId: z.string().min(1),
});

export async function updateEquipment(input: z.infer<typeof updateSchema>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  assertCan(actor, "equipment.manage", { id: actor.organizationId });
  const d = updateSchema.parse(input);

  const target = await prisma.equipment.findUnique({
    where: { id: d.equipmentId },
    select: { organizationId: true },
  });
  if (!target || target.organizationId !== actor.organizationId) {
    throw new Error("Equipment not found");
  }

  await prisma.equipment.update({
    where: { id: d.equipmentId },
    data: {
      assetTag: d.assetTag,
      type: d.type,
      manufacturer: d.manufacturer ?? null,
      model: d.model ?? null,
      serialNumber: d.serialNumber ?? null,
      amperage: d.amperage ?? null,
      cfm: d.cfm ?? null,
      ppd: d.ppd ?? null,
      status: d.status,
      notes: d.notes ?? null,
    },
  });

  await recordAudit("equipment.update", { actor: { userId: actor.id }, jobId: null }, {
    equipmentId: d.equipmentId,
  });

  revalidatePath("/app/equipment");
}

const retireSchema = z.object({
  equipmentId: z.string().min(1),
  retire: z.boolean(),
});

export async function setEquipmentRetired(input: z.infer<typeof retireSchema>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  assertCan(actor, "equipment.manage", { id: actor.organizationId });
  const d = retireSchema.parse(input);

  const target = await prisma.equipment.findUnique({
    where: { id: d.equipmentId },
    select: { organizationId: true, status: true, placements: { where: { removedAt: null }, select: { id: true } } },
  });
  if (!target || target.organizationId !== actor.organizationId) {
    throw new Error("Equipment not found");
  }
  if (d.retire && target.placements.length > 0) {
    throw new Error("Remove this unit from its current job before retiring it.");
  }

  await prisma.equipment.update({
    where: { id: d.equipmentId },
    data: {
      status: d.retire
        ? EquipmentStatus.RETIRED
        : target.status === EquipmentStatus.RETIRED
          ? EquipmentStatus.AVAILABLE
          : target.status,
    },
  });

  await recordAudit(
    d.retire ? "equipment.retire" : "equipment.unretire",
    { actor: { userId: actor.id }, jobId: null },
    { equipmentId: d.equipmentId },
  );
  revalidatePath("/app/equipment");
}

export interface BulkImportResult {
  ok: boolean;
  imported: number;
  skipped: number;
  errors: Array<{ line: number; message: string }>;
}

const bulkSchema = z.object({ csv: z.string().trim().min(1) });

export async function bulkImportEquipment(
  _prev: BulkImportResult | EquipmentActionResult,
  formData: FormData,
): Promise<BulkImportResult> {
  const actor = await getSessionUser();
  if (!actor) {
    return { ok: false, imported: 0, skipped: 0, errors: [{ line: 0, message: "Not signed in" }] };
  }
  assertCan(actor, "equipment.manage", { id: actor.organizationId });

  const parsedInput = bulkSchema.safeParse({ csv: formData.get("csv") });
  if (!parsedInput.success) {
    return { ok: false, imported: 0, skipped: 0, errors: [{ line: 0, message: "Paste a CSV body" }] };
  }

  const parsed = parseEquipmentCsv(parsedInput.data.csv);
  if (parsed.errors.length > 0) {
    return { ok: false, imported: 0, skipped: 0, errors: parsed.errors };
  }

  let imported = 0;
  let skipped = 0;
  const writeErrors: Array<{ line: number; message: string }> = [];
  let line = 1;
  for (const row of parsed.rows) {
    line++;
    try {
      await prisma.equipment.create({
        data: {
          organizationId: actor.organizationId,
          ...row,
        },
      });
      imported++;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        skipped++;
        writeErrors.push({
          line,
          message: `Skipped: assetTag ${row.assetTag} already exists.`,
        });
      } else {
        throw err;
      }
    }
  }

  await recordAudit(
    "equipment.bulk_import",
    { actor: { userId: actor.id }, jobId: null },
    { imported, skipped },
  );

  revalidatePath("/app/equipment");
  return { ok: imported > 0, imported, skipped, errors: writeErrors };
}
