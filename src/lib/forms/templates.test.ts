import { describe, expect, it } from "vitest";
import {
  DEFAULT_AOB_BODY,
  DEFAULT_AOB_FIELDS,
  DEFAULT_COC_BODY,
  DEFAULT_COC_FIELDS,
  formSchemaSchema,
  isSignatureComplete,
  renderTemplate,
  validateValues,
  type RenderContext,
} from "./templates";

const ctx: RenderContext = {
  job: {
    jobNumber: "1800WD-2026-0042",
    lossDate: new Date(Date.UTC(2026, 4, 5)),
    causeOfLoss: "Supply line burst",
    scopeNotes: "Cat 2 water in kitchen + living room",
  },
  customer: {
    firstName: "Sarah",
    lastName: "Demo",
    addressLine1: "412 Stewart Ave",
    city: "Garden City",
    state: "NY",
    postalCode: "11530",
  },
  org: {
    name: "1-800 Water Damage of Nassau County",
    primaryColor: "#1e3a8a",
    reportFooter: "License #12345",
  },
};

describe("formSchemaSchema", () => {
  it("validates the seeded AOB schema", () => {
    expect(() => formSchemaSchema.parse({ fields: DEFAULT_AOB_FIELDS })).not.toThrow();
  });
  it("validates the seeded COC schema", () => {
    expect(() => formSchemaSchema.parse({ fields: DEFAULT_COC_FIELDS })).not.toThrow();
  });
  it("rejects unknown field types", () => {
    expect(() =>
      formSchemaSchema.parse({
        fields: [{ id: "x", label: "X", type: "barcode" }],
      }),
    ).toThrow();
  });
});

describe("renderTemplate", () => {
  it("interpolates customer + job fields", () => {
    const out = renderTemplate(DEFAULT_AOB_BODY, ctx);
    expect(out).toContain("Sarah Demo");
    expect(out).toContain("412 Stewart Ave");
    expect(out).toContain("1-800 Water Damage of Nassau County");
    // Date helper renders English
    expect(out).toMatch(/May 5, 2026|May  5, 2026/);
  });

  it("conditionally renders blocks via {{#if}}", () => {
    const out = renderTemplate(DEFAULT_COC_BODY, {
      ...ctx,
      values: {
        completionDate: "2026-05-12",
        comments: "All work completed to satisfaction.",
      },
    });
    expect(out).toContain("All work completed");
    // satisfactionRating not provided — block omitted
    expect(out).not.toContain("Satisfaction rating (1-5):");
  });

  it("escapes HTML in user-provided values", () => {
    const out = renderTemplate(DEFAULT_COC_BODY, {
      ...ctx,
      values: {
        completionDate: "2026-05-12",
        comments: "<script>alert(1)</script>",
      },
    });
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });
});

describe("isSignatureComplete", () => {
  it("requires every required signature field to have a data URL", () => {
    expect(
      isSignatureComplete(
        { fields: DEFAULT_AOB_FIELDS },
        { customerSignature: "data:image/png;base64,iVBOR..." },
      ),
    ).toBe(true);
    expect(
      isSignatureComplete({ fields: DEFAULT_AOB_FIELDS }, {}),
    ).toBe(false);
    expect(
      isSignatureComplete(
        { fields: DEFAULT_AOB_FIELDS },
        { customerSignature: "not-a-data-url" },
      ),
    ).toBe(false);
  });
});

describe("validateValues", () => {
  it("collects missing required fields", () => {
    const r = validateValues({ fields: DEFAULT_COC_FIELDS }, {
      customerName: "Sarah",
      // completionDate missing, customerSignature missing
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("Completion date");
    expect(r.missing).toContain("Customer signature");
  });
  it("accepts a fully-filled values map", () => {
    const r = validateValues({ fields: DEFAULT_COC_FIELDS }, {
      customerName: "Sarah",
      completionDate: "2026-05-12",
      customerSignature: "data:image/png;base64,iVBORw0KGg",
    });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });
});
