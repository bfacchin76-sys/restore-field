/**
 * FormTemplate helpers — schema validation + Handlebars rendering.
 *
 *   - `formSchemaSchema`: zod for the JSON `FormTemplate.schema` blob,
 *     which lists fillable fields with `id`, `label`, `type`, `required`.
 *   - `renderTemplate()`: takes template HTML + a context object and returns
 *     fully-rendered HTML for the signing page or the PDF generator.
 *   - Default templates (AOB, COC) are the same Handlebars strings the
 *     seed plants — exported here so we have a single source of truth.
 */

import Handlebars from "handlebars";
import { z } from "zod";

export const formFieldSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  type: z.enum(["text", "textarea", "date", "email", "signature", "checkbox"]),
  required: z.boolean().default(false),
  /** Default value — only used for `text` / `textarea`. */
  defaultValue: z.string().optional(),
  /** Placeholder hint shown above the input. */
  placeholder: z.string().optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const formSchemaSchema = z.object({
  fields: z.array(formFieldSchema).min(1).max(40),
});
export type FormSchema = z.infer<typeof formSchemaSchema>;

/**
 * The values map persisted on `FormSubmission.values`. Keys are field
 * ids; signature fields hold the data-URL of the captured signature.
 */
export const formValuesSchema = z.record(z.string(), z.union([z.string(), z.boolean()]));
export type FormValues = z.infer<typeof formValuesSchema>;

// =============================================================================
// Handlebars rendering
// =============================================================================

let helpersRegistered = false;
function registerHelpers() {
  if (helpersRegistered) return;
  helpersRegistered = true;

  // Format a Date / ISO string as a human-readable date.
  Handlebars.registerHelper("date", (value: unknown) => {
    if (!value) return "";
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  });

  Handlebars.registerHelper("datetime", (value: unknown) => {
    if (!value) return "";
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("en-US");
  });

  Handlebars.registerHelper("default", (value: unknown, fallback: unknown) =>
    value == null || value === "" ? fallback : value,
  );
}

export interface RenderContext {
  job: {
    jobNumber: string;
    lossDate: Date | string | null;
    causeOfLoss?: string | null;
    scopeNotes?: string | null;
  };
  customer: {
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state: string;
    postalCode: string;
    insuranceCarrier?: string | null;
    policyNumber?: string | null;
    claimNumber?: string | null;
  };
  org: {
    name: string;
    primaryColor: string;
    reportFooter?: string | null;
  };
  /** Field values keyed by field id — overlays anything in the template. */
  values?: Record<string, string | boolean>;
  /** Convenience aliases for common fields. */
  completionDate?: string;
  signedAt?: string;
}

/**
 * Render `bodyTemplate` (a Handlebars string) into HTML using the given
 * context. Used by both the signing page render and the PDF generator —
 * same template, same output, just different surrounding chrome.
 */
export function renderTemplate(
  bodyTemplate: string,
  ctx: RenderContext,
): string {
  registerHelpers();
  const compiled = Handlebars.compile(bodyTemplate, { noEscape: false });
  // Spread `values` so referenced field ids work directly inside templates.
  const data = { ...(ctx.values ?? {}), ...ctx };
  return compiled(data);
}

// =============================================================================
// Default template definitions (AOB + COC). Mirrors prisma/seed.ts.
// =============================================================================

export const DEFAULT_AOB_FIELDS: FormField[] = [
  { id: "customerName", label: "Customer name", type: "text", required: true },
  { id: "lossAddress", label: "Loss address", type: "text", required: true },
  { id: "lossDate", label: "Date of loss", type: "date", required: true },
  { id: "scopeSummary", label: "Scope summary", type: "textarea", required: false },
  { id: "customerSignature", label: "Customer signature", type: "signature", required: true },
];

export const DEFAULT_COC_FIELDS: FormField[] = [
  { id: "customerName", label: "Customer name", type: "text", required: true },
  { id: "completionDate", label: "Completion date", type: "date", required: true },
  { id: "satisfactionRating", label: "Satisfaction (1-5)", type: "text", required: false },
  { id: "comments", label: "Comments", type: "textarea", required: false },
  { id: "customerSignature", label: "Customer signature", type: "signature", required: true },
];

export const DEFAULT_AOB_BODY = `<h1>Authorization to Perform Services</h1>
<p>I, <strong>{{customer.firstName}} {{customer.lastName}}</strong>, the undersigned, authorize {{org.name}} to perform restoration services at <strong>{{customer.addressLine1}}, {{customer.city}}, {{customer.state}} {{customer.postalCode}}</strong> in connection with the loss occurring on or about <strong>{{date job.lossDate}}</strong>.</p>
<p>I understand that I remain responsible for any deductible and any charges not covered by my insurance carrier.</p>
<p>I authorize my insurance carrier to release information regarding this claim to {{org.name}} and to issue payment directly to {{org.name}} for services rendered.</p>
{{#if scopeSummary}}<p><strong>Scope summary:</strong> {{scopeSummary}}</p>{{/if}}`;

export const DEFAULT_COC_BODY = `<h1>Certificate of Completion</h1>
<p>I, <strong>{{customer.firstName}} {{customer.lastName}}</strong>, acknowledge that {{org.name}} has completed the agreed-upon restoration services at <strong>{{customer.addressLine1}}, {{customer.city}}, {{customer.state}} {{customer.postalCode}}</strong> for job <strong>{{job.jobNumber}}</strong>.</p>
<p>The work has been performed to my satisfaction as of <strong>{{date completionDate}}</strong>.</p>
{{#if satisfactionRating}}<p><strong>Satisfaction rating (1-5):</strong> {{satisfactionRating}}</p>{{/if}}
{{#if comments}}<p><strong>Comments:</strong> {{comments}}</p>{{/if}}`;

/** True when the schema's signature fields are all present in `values`. */
export function isSignatureComplete(
  schema: FormSchema,
  values: FormValues,
): boolean {
  for (const f of schema.fields) {
    if (f.type === "signature" && f.required) {
      const v = values[f.id];
      if (typeof v !== "string" || !v.startsWith("data:image/")) {
        return false;
      }
    }
  }
  return true;
}

/** True when every required field has a non-empty value. */
export function validateValues(
  schema: FormSchema,
  values: FormValues,
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const f of schema.fields) {
    if (!f.required) continue;
    const v = values[f.id];
    if (
      v === undefined ||
      v === null ||
      (typeof v === "string" && v.trim().length === 0)
    ) {
      missing.push(f.label);
    } else if (f.type === "signature" && (typeof v !== "string" || !v.startsWith("data:image/"))) {
      missing.push(f.label);
    }
  }
  return { ok: missing.length === 0, missing };
}
