"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { formSchemaSchema, type FormSchema } from "@/lib/forms/templates";

export interface TemplateActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const templateInput = z.object({
  name: z.string().trim().min(1).max(80),
  schema: z.string().trim().min(2),
  bodyTemplate: z.string().trim().min(1),
});

function readForm(formData: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) o[k] = v;
  return o;
}

function parseSchemaJson(raw: string): { schema: FormSchema; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      schema: { fields: [] } as unknown as FormSchema,
      error:
        "Schema is not valid JSON: " +
        (err instanceof Error ? err.message : "syntax error"),
    };
  }
  const result = formSchemaSchema.safeParse(parsed);
  if (!result.success) {
    return {
      schema: { fields: [] } as unknown as FormSchema,
      error: result.error.issues[0]?.message ?? "Invalid schema",
    };
  }
  return { schema: result.data };
}

export async function createFormTemplate(
  _prev: TemplateActionResult,
  formData: FormData,
): Promise<TemplateActionResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };
  assertCan(actor, "user.manage", { id: actor.organizationId });

  const parsed = templateInput.safeParse(readForm(formData));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path.join(".") || "_form";
      if (!fe[k]) fe[k] = issue.message;
    }
    return { ok: false, fieldErrors: fe };
  }

  const schemaParse = parseSchemaJson(parsed.data.schema);
  if (schemaParse.error) {
    return { ok: false, fieldErrors: { schema: schemaParse.error } };
  }

  const tpl = await prisma.formTemplate.create({
    data: {
      organizationId: actor.organizationId,
      name: parsed.data.name,
      schema: schemaParse.schema as object,
      bodyTemplate: parsed.data.bodyTemplate,
      active: true,
    },
  });

  await recordAudit(
    "form_template.create",
    { actor: { userId: actor.id }, jobId: null },
    { templateId: tpl.id, name: tpl.name },
  );

  revalidatePath("/app/admin/forms");
  return { ok: true, message: "Template saved." };
}

const updateInput = templateInput.extend({
  templateId: z.string().min(1),
});

export async function updateFormTemplate(input: z.infer<typeof updateInput>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  assertCan(actor, "user.manage", { id: actor.organizationId });
  const data = updateInput.parse(input);

  const target = await prisma.formTemplate.findUnique({
    where: { id: data.templateId },
    select: { organizationId: true },
  });
  if (!target || target.organizationId !== actor.organizationId) {
    throw new Error("Template not found");
  }

  const schemaParse = parseSchemaJson(data.schema);
  if (schemaParse.error) {
    throw new Error(`Invalid schema: ${schemaParse.error}`);
  }

  await prisma.formTemplate.update({
    where: { id: data.templateId },
    data: {
      name: data.name,
      schema: schemaParse.schema as object,
      bodyTemplate: data.bodyTemplate,
    },
  });

  await recordAudit(
    "form_template.update",
    { actor: { userId: actor.id }, jobId: null },
    { templateId: data.templateId },
  );

  revalidatePath("/app/admin/forms");
}

export async function setFormTemplateActive(input: {
  templateId: string;
  active: boolean;
}) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  assertCan(actor, "user.manage", { id: actor.organizationId });

  const target = await prisma.formTemplate.findUnique({
    where: { id: input.templateId },
    select: { organizationId: true },
  });
  if (!target || target.organizationId !== actor.organizationId) {
    throw new Error("Template not found");
  }

  await prisma.formTemplate.update({
    where: { id: input.templateId },
    data: { active: input.active },
  });

  await recordAudit(
    input.active ? "form_template.activate" : "form_template.deactivate",
    { actor: { userId: actor.id }, jobId: null },
    { templateId: input.templateId },
  );

  revalidatePath("/app/admin/forms");
}
