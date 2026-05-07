"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import {
  customerSchema,
  toCustomerData,
} from "@/lib/business/customer-schema";

export interface CustomerActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  customerId?: string;
}

function flattenErrors(err: import("zod").ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function readForm(formData: FormData) {
  return Object.fromEntries(formData.entries()) as Record<string, string>;
}

export async function createCustomer(
  _prev: CustomerActionResult,
  formData: FormData,
): Promise<CustomerActionResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };

  const parsed = customerSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  }

  const data = toCustomerData(parsed.data);
  const customer = await prisma.customer.create({
    data: { ...data, organizationId: actor.organizationId },
  });

  await recordAudit(
    "customer.create",
    { actor: { userId: actor.id }, jobId: null },
    { customerId: customer.id, name: `${customer.firstName} ${customer.lastName}` },
  );

  revalidatePath("/app/customers");
  // Redirect into the customer's record so the user can immediately
  // start a job for them.
  redirect(`/app/customers/${customer.id}`);
}

export async function updateCustomer(
  customerId: string,
  _prev: CustomerActionResult,
  formData: FormData,
): Promise<CustomerActionResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };

  const existing = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { organizationId: true },
  });
  if (!existing || existing.organizationId !== actor.organizationId) {
    return { ok: false, message: "Customer not found" };
  }

  const parsed = customerSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  }

  const data = toCustomerData(parsed.data);
  await prisma.customer.update({
    where: { id: customerId },
    data,
  });

  await recordAudit(
    "customer.update",
    { actor: { userId: actor.id }, jobId: null },
    { customerId },
  );

  revalidatePath(`/app/customers/${customerId}`);
  revalidatePath("/app/customers");
  return { ok: true, message: "Saved.", customerId };
}
