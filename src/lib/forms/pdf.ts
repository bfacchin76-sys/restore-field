import "server-only";
import puppeteer from "puppeteer";
import Handlebars from "handlebars";
import { logger } from "@/lib/logger";
import { renderTemplate, type RenderContext, type FormSchema, type FormValues } from "./templates";

export interface SignedPdfInput {
  templateName: string;
  bodyTemplate: string;
  schema: FormSchema;
  values: FormValues;
  context: RenderContext;
  signatures: Array<{
    signerName: string;
    signerEmail: string | null;
    signerRole: string;
    signedAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
    signatureDataUrl: string;
  }>;
}

const PAGE_CSS = `
  @page { size: letter; margin: 0.75in; }
  html, body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; }
  body { font-size: 11pt; line-height: 1.5; }
  h1 { color: #1e3a8a; font-size: 18pt; margin: 0 0 12pt; }
  h2 { color: #1e3a8a; font-size: 13pt; margin: 18pt 0 6pt; }
  p { margin: 0 0 8pt; }
  strong { color: #0f172a; }
  .header { border-bottom: 4px solid #1e3a8a; padding-bottom: 6pt; margin-bottom: 18pt; }
  .org-name { font-size: 10pt; color: #1e3a8a; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
  .job-meta { font-size: 9pt; color: #475569; }
  .filled { background: #f1f5f9; padding: 2pt 6pt; border-radius: 3pt; display: inline-block; }
  .field-block { margin-bottom: 10pt; }
  .field-label { font-size: 9pt; font-weight: 600; text-transform: uppercase; color: #475569; }
  .field-value { font-size: 11pt; }
  .signature-row { display: flex; gap: 18pt; margin-top: 24pt; page-break-inside: avoid; }
  .signature-box { flex: 1; }
  .signature-label { font-size: 8pt; font-weight: 600; text-transform: uppercase; color: #475569; }
  .signature-image { border-bottom: 1pt solid #94a3b8; height: 60pt; display: flex; align-items: end; padding-bottom: 4pt; }
  .signature-image img { max-height: 56pt; max-width: 100%; }
  .signature-meta { font-size: 8pt; color: #475569; margin-top: 4pt; }
  .audit-page { page-break-before: always; padding-top: 18pt; }
  .audit-page table { width: 100%; border-collapse: collapse; margin-top: 6pt; font-size: 9pt; }
  .audit-page th { text-align: left; font-weight: 600; padding: 4pt 8pt; border-bottom: 1pt solid #cbd5e1; color: #475569; }
  .audit-page td { padding: 4pt 8pt; border-bottom: 1pt solid #e2e8f0; vertical-align: top; }
  .footer { margin-top: 36pt; padding-top: 6pt; border-top: 1px solid #cbd5e1; font-size: 9pt; color: #475569; }
  .checkbox { display: inline-block; width: 10pt; height: 10pt; border: 1pt solid #475569; vertical-align: middle; margin-right: 4pt; }
  .checkbox.checked { background: #1e3a8a; border-color: #1e3a8a; }
`;

const PAGE_TEMPLATE = Handlebars.compile(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><title>{{templateName}}</title><style>{{{css}}}</style></head>
<body>
  <header class="header">
    <div class="org-name">{{context.org.name}}</div>
    <div class="job-meta">
      Job {{context.job.jobNumber}}
      &middot;
      {{context.customer.firstName}} {{context.customer.lastName}}
      &middot;
      {{context.customer.addressLine1}}, {{context.customer.city}}, {{context.customer.state}} {{context.customer.postalCode}}
    </div>
  </header>

  <main>
    {{{body}}}

    {{#if filledFields}}
    <h2>Form values</h2>
    {{#each filledFields}}
      <div class="field-block">
        <div class="field-label">{{label}}</div>
        <div class="field-value">{{{value}}}</div>
      </div>
    {{/each}}
    {{/if}}

    <div class="signature-row">
      {{#each signatures}}
      <div class="signature-box">
        <div class="signature-label">{{signerRole}} signature</div>
        <div class="signature-image">
          <img src="{{{signatureDataUrl}}}" alt="signature"/>
        </div>
        <div class="signature-meta">
          {{signerName}}{{#if signerEmail}} &middot; {{signerEmail}}{{/if}}
          <br/>{{datetime signedAt}}
        </div>
      </div>
      {{/each}}
    </div>
  </main>

  <section class="audit-page">
    <h2>Audit metadata</h2>
    <p>This page is generated automatically and is part of the legal record. Tampering invalidates the document.</p>
    <table>
      <thead>
        <tr>
          <th>Signer</th>
          <th>Email</th>
          <th>Role</th>
          <th>Signed at</th>
          <th>IP address</th>
          <th>User agent</th>
        </tr>
      </thead>
      <tbody>
        {{#each signatures}}
        <tr>
          <td>{{signerName}}</td>
          <td>{{default signerEmail "—"}}</td>
          <td>{{signerRole}}</td>
          <td>{{datetime signedAt}}</td>
          <td>{{default ipAddress "—"}}</td>
          <td>{{default userAgent "—"}}</td>
        </tr>
        {{/each}}
      </tbody>
    </table>
    <div class="footer">
      Document &ldquo;{{templateName}}&rdquo; &middot; {{context.org.name}}{{#if context.org.reportFooter}} &middot; {{context.org.reportFooter}}{{/if}}
    </div>
  </section>
</body>
</html>`);

interface FilledField {
  label: string;
  value: string;
}

function buildFilledFields(
  schema: FormSchema,
  values: FormValues,
): FilledField[] {
  const out: FilledField[] = [];
  for (const f of schema.fields) {
    // Don't echo signature data-URLs into the body — they're shown
    // separately in the signature row. Skip empty values.
    if (f.type === "signature") continue;
    const raw = values[f.id];
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw === "boolean") {
      out.push({
        label: f.label,
        value: raw
          ? '<span class="checkbox checked"></span>Yes'
          : '<span class="checkbox"></span>No',
      });
    } else {
      // Conservative escape — Handlebars in the body template does its own.
      out.push({
        label: f.label,
        value: String(raw)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br/>"),
      });
    }
  }
  return out;
}

/**
 * Render the signed-form HTML — same content the PDF wraps. Useful for
 * snapshot testing and DoD walkthroughs that need to grep audit-page
 * metadata (Puppeteer rasterises text as glyph paths, so the PDF binary
 * isn't text-searchable).
 */
export function renderSignedFormHtml(input: SignedPdfInput): string {
  const body = renderTemplate(input.bodyTemplate, {
    ...input.context,
    values: input.values,
  });
  const filledFields = buildFilledFields(input.schema, input.values);
  return PAGE_TEMPLATE({
    templateName: input.templateName,
    css: PAGE_CSS,
    context: input.context,
    body,
    filledFields,
    signatures: input.signatures,
  });
}

/**
 * Build a signed-form PDF: renders the template body, lists filled
 * field values, embeds each signature as an image, and appends a
 * tamper-evidence audit page (PRD §8.6).
 */
export async function renderSignedFormPdf(
  input: SignedPdfInput,
): Promise<Buffer> {
  const html = renderSignedFormHtml(input);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    // Pass an inert base URL so any relative URLs (none, but defensive) don't
    // try to fetch from the public internet.
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdf = await page.pdf({
      format: "letter",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return Buffer.from(pdf);
  } catch (err) {
    logger.error({ err }, "renderSignedFormPdf failed");
    throw err;
  } finally {
    await browser.close();
  }
}
