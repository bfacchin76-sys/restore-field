/**
 * Per-report-type Handlebars HTML templates.
 *
 * One template per `ReportType`. They all share the same chrome (header
 * with org name + license, footer with company info) and the same CSS,
 * which lives in `templates-css.ts` so the renderer can inject it once.
 *
 * Each template receives a fully-populated `ReportSnapshot` plus a few
 * derived helpers wired up in `render.ts`. We deliberately keep the
 * templates pure-string Handlebars — easy to diff in PRs, easy to test
 * by snapshotting the HTML output (Puppeteer is only needed for the PDF).
 */

import type { ReportType } from "@prisma/client";

export const REPORT_PAGE_CSS = `
  @page { size: letter; margin: 0; }
  html, body {
    margin: 0; padding: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #0f172a;
  }
  body { font-size: 10.5pt; line-height: 1.45; }
  .page { padding: 0.6in 0.6in 0.7in; box-sizing: border-box; }
  .page + .page { page-break-before: always; }

  h1 { color: #1e3a8a; font-size: 22pt; margin: 0 0 8pt; letter-spacing: -0.01em; }
  h2 { color: #1e3a8a; font-size: 14pt; margin: 18pt 0 8pt; border-bottom: 1pt solid #cbd5e1; padding-bottom: 4pt; }
  h3 { color: #1e3a8a; font-size: 11pt; margin: 14pt 0 4pt; }
  p { margin: 0 0 8pt; }

  .header {
    background: #1e3a8a; color: white;
    padding: 14pt 0.6in;
    display: flex; align-items: center; justify-content: space-between;
  }
  .header .brand { display: flex; align-items: center; gap: 10pt; }
  .header .brand-logo { max-height: 28pt; max-width: 140pt; object-fit: contain; display: block; }
  .header .brand-name { font-size: 16pt; font-weight: 700; letter-spacing: 0.02em; }
  .header .brand-meta { font-size: 9pt; opacity: 0.85; text-align: right; }

  .cover .title-block { margin-top: 60pt; }
  .cover .report-type { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.18em; color: #475569; }
  .cover h1 { font-size: 28pt; margin-top: 8pt; }
  .cover .job-line { font-size: 13pt; color: #1e3a8a; font-weight: 600; margin-top: 18pt; }
  .cover .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18pt; margin-top: 36pt; }
  .cover .meta-grid h3 { margin-top: 0; }

  table { width: 100%; border-collapse: collapse; margin: 4pt 0 8pt; font-size: 9.5pt; }
  th { text-align: left; font-weight: 600; padding: 4pt 6pt; border-bottom: 1pt solid #cbd5e1; color: #475569; }
  td { padding: 4pt 6pt; border-bottom: 1pt solid #e2e8f0; vertical-align: top; }
  tr.totals td { font-weight: 700; border-top: 2pt solid #1e3a8a; }

  .pill { display: inline-block; padding: 1pt 6pt; border-radius: 999pt; background: #dbeafe; color: #1e3a8a; font-size: 8.5pt; font-weight: 600; }

  .photo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12pt; }
  .photo-card { page-break-inside: avoid; border: 1pt solid #e2e8f0; border-radius: 4pt; overflow: hidden; }
  .photo-card .img { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; background: #f1f5f9; }
  .photo-card .meta { padding: 6pt 8pt; font-size: 9pt; }
  .photo-card .meta .room { color: #1e3a8a; font-weight: 600; }
  .photo-card .meta .caption { color: #0f172a; }
  .photo-card .meta .gps { color: #64748b; font-size: 8pt; }

  .kvp { display: grid; grid-template-columns: 35% 65%; gap: 2pt 8pt; font-size: 9.5pt; }
  .kvp .k { color: #475569; font-weight: 600; }
  .kvp .v { color: #0f172a; }

  .totals-row { display: flex; justify-content: space-between; padding: 4pt 0; border-bottom: 1pt solid #e2e8f0; }
  .totals-row.grand { border-top: 2pt solid #1e3a8a; border-bottom: none; font-weight: 700; font-size: 12pt; padding-top: 8pt; margin-top: 4pt; }
  .totals-row .label { color: #475569; }

  .summary-callout { background: #f1f5f9; border-left: 3pt solid #1e3a8a; padding: 8pt 12pt; margin: 8pt 0; border-radius: 0 4pt 4pt 0; }
  .nodata { color: #94a3b8; font-style: italic; }
`;

export const REPORT_FOOTER_TEMPLATE = `
<div style="font-size: 8pt; color: #475569; padding: 0 0.5in; width: 100%; display: flex; justify-content: space-between;">
  <div>
    {{orgName}}{{#if licenseNumber}} &middot; License {{licenseNumber}}{{/if}}
  </div>
  <div>
    Job {{jobNumber}} &middot; Generated {{generatedAt}} &middot;
    Page <span class="pageNumber"></span> of <span class="totalPages"></span>
  </div>
</div>
`;

const HEADER_BAND = `
<header class="header">
  <div class="brand">
    {{#if org.logoDataUrl}}
    <img class="brand-logo" src="{{{org.logoDataUrl}}}" alt="{{org.name}} logo"/>
    {{/if}}
    <div class="brand-name">{{org.name}}</div>
  </div>
  <div class="brand-meta">
    {{#if org.licenseNumber}}License {{org.licenseNumber}}<br/>{{/if}}
    Job {{job.jobNumber}}
  </div>
</header>
`;

/** Cover page used by every report. */
const COVER_PAGE = `
<section class="page cover">
  ${HEADER_BAND}
  <div class="title-block">
    <div class="report-type">{{reportTypeLabel}}</div>
    <h1>{{reportTitle}}</h1>
    <div class="job-line">Job {{job.jobNumber}} &middot; {{customer.lastName}}, {{customer.firstName}}</div>
  </div>
  <div class="meta-grid">
    <div>
      <h3>Property</h3>
      <div>{{customer.firstName}} {{customer.lastName}}</div>
      <div>{{customer.addressLine1}}</div>
      {{#if customer.addressLine2}}<div>{{customer.addressLine2}}</div>{{/if}}
      <div>{{customer.city}}, {{customer.state}} {{customer.postalCode}}</div>
      {{#if customer.phone}}<div>{{customer.phone}}</div>{{/if}}
      {{#if customer.email}}<div>{{customer.email}}</div>{{/if}}
    </div>
    <div>
      <h3>Insurance / claim</h3>
      <div>{{default customer.insuranceCarrier "&mdash;"}}</div>
      <div>Policy: {{default customer.policyNumber "&mdash;"}}</div>
      <div>Claim: {{default customer.claimNumber "&mdash;"}}</div>
      {{#if customer.adjusterName}}
      <div style="margin-top:6pt">Adjuster: {{customer.adjusterName}}</div>
      {{#if customer.adjusterPhone}}<div>{{customer.adjusterPhone}}</div>{{/if}}
      {{/if}}
    </div>
    <div>
      <h3>Loss</h3>
      <div>Type: {{lossTypeLabel}}</div>
      <div>Date of loss: {{date job.lossDate}}</div>
      <div>First response: {{date job.firstResponseAt}}</div>
      {{#if job.causeOfLoss}}<div style="margin-top:6pt">Cause: {{job.causeOfLoss}}</div>{{/if}}
    </div>
    <div>
      <h3>Report</h3>
      <div>Generated: {{datetime generatedAt}}</div>
      <div>Affected area: {{number totalAffectedSqFt}} sqft</div>
      <div>Photos: {{photos.length}}</div>
      <div>Readings: {{readings.length}}</div>
      <div>Drying logs: {{dryingLogs.length}}</div>
    </div>
  </div>
  {{#if scopeSummary}}
  <div class="summary-callout" style="margin-top: 24pt;">
    <h3 style="margin-top:0;">Scope summary</h3>
    <p>{{scopeSummary}}</p>
  </div>
  {{/if}}
</section>
`;

const ROOMS_BLOCK = `
{{#if rooms.length}}
<h2>Rooms ({{rooms.length}})</h2>
<table>
  <thead>
    <tr>
      <th>Name</th><th>Floor</th><th>Dimensions</th><th>Category / Class</th><th>Affected materials</th>
    </tr>
  </thead>
  <tbody>
    {{#each rooms}}
    <tr>
      <td><strong>{{name}}</strong></td>
      <td>{{default floor "&mdash;"}}</td>
      <td>{{#if lengthFt}}{{lengthFt}}&prime; &times; {{widthFt}}&prime;{{#if heightFt}} &times; {{heightFt}}&prime;{{/if}}{{else}}&mdash;{{/if}}</td>
      <td>{{default category "&mdash;"}}{{#if classOfLoss}} / {{classOfLoss}}{{/if}}</td>
      <td>{{join affectedMaterials ", "}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{/if}}
`;

const READINGS_BLOCK = `
{{#if readings.length}}
<h2>Moisture readings ({{readings.length}})</h2>
<table>
  <thead>
    <tr>
      <th>Date / time</th><th>Room</th><th>Surface</th><th>Material</th><th>Meter</th><th>Value</th><th>Status</th>
    </tr>
  </thead>
  <tbody>
    {{#each readings}}
    <tr>
      <td>{{datetime takenAt}}</td>
      <td>{{default roomName "&mdash;"}}</td>
      <td>{{surface}}</td>
      <td>{{material}}</td>
      <td>{{meterType}}</td>
      <td>{{moistureValue}} {{scaleUnit scaleType}}</td>
      <td>{{readingStatus this}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{/if}}
`;

const DRYING_LOG_BLOCK = `
{{#if dryingLogs.length}}
<h2>Daily drying log ({{dryingLogs.length}} day{{#unless (eq dryingLogs.length 1)}}s{{/unless}})</h2>
<table>
  <thead>
    <tr>
      <th>Date</th>
      <th>Outside (T/RH/GPP)</th>
      <th>Unaffected</th>
      <th>Affected</th>
      <th>HVAC</th>
      <th>Tech notes</th>
    </tr>
  </thead>
  <tbody>
    {{#each dryingLogs}}
    <tr>
      <td>{{date logDate}}</td>
      <td>{{psyc outsideTempF outsideRH outsideGPP}}</td>
      <td>{{psyc unaffectedTempF unaffectedRH unaffectedGPP}}</td>
      <td>{{psyc affectedTempF affectedRH affectedGPP}}</td>
      <td>{{psyc hvacTempF hvacRH hvacGPP}}</td>
      <td>{{default techNotes "&mdash;"}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{/if}}
`;

const EQUIPMENT_BLOCK = `
{{#if placements.length}}
<h2>Equipment placements ({{placements.length}})</h2>
<table>
  <thead>
    <tr>
      <th>Asset tag</th><th>Type</th><th>Manufacturer / Model</th><th>Room</th><th>Placed</th><th>Removed</th>
    </tr>
  </thead>
  <tbody>
    {{#each placements}}
    <tr>
      <td>{{assetTag}}</td>
      <td>{{type}}</td>
      <td>{{default manufacturer "&mdash;"}} {{default model ""}}</td>
      <td>{{default roomName "&mdash;"}}</td>
      <td>{{datetime placedAt}}</td>
      <td>{{#if removedAt}}{{datetime removedAt}}{{else}}<span class="pill">Active</span>{{/if}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{/if}}

{{#if dailyEquipmentCounts.length}}
<h3>Daily totals</h3>
<table>
  <thead><tr><th>Day</th><th>Total deployed</th><th>By type</th></tr></thead>
  <tbody>
    {{#each dailyEquipmentCounts}}
    <tr>
      <td>{{day}}</td>
      <td>{{total}}</td>
      <td>{{byTypeList byType}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{/if}}
`;

const PHOTOS_BLOCK = `
{{#if photos.length}}
<h2>Photo log ({{photos.length}})</h2>
<div class="photo-grid">
  {{#each photos}}
  <div class="photo-card">
    {{#if imageDataUrl}}
    <img class="img" src="{{{imageDataUrl}}}" alt="photo"/>
    {{else}}
    <div class="img" style="display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:9pt;">image unavailable</div>
    {{/if}}
    <div class="meta">
      {{#if roomName}}<div class="room">{{roomName}}</div>{{/if}}
      {{#if caption}}<div class="caption">{{caption}}</div>{{/if}}
      <div class="gps">
        {{#if takenAt}}{{datetime takenAt}}{{/if}}
        {{#if gpsLat}} &middot; {{gpsLat}}, {{gpsLng}}{{/if}}
        {{#if salvageability}} &middot; {{salvageability}}{{/if}}
      </div>
    </div>
  </div>
  {{/each}}
</div>
{{/if}}
`;

const FORMS_BLOCK = `
{{#if forms.length}}
<h2>Signed forms ({{forms.length}})</h2>
<table>
  <thead><tr><th>Form</th><th>Status</th><th>Signed at</th><th>Signers</th></tr></thead>
  <tbody>
    {{#each forms}}
    <tr>
      <td>{{templateName}}</td>
      <td>{{status}}</td>
      <td>{{#if signedAt}}{{datetime signedAt}}{{else}}&mdash;{{/if}}</td>
      <td>
        {{#each signers}}{{name}} ({{role}}){{#unless @last}}, {{/unless}}{{/each}}
      </td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{/if}}
`;

const ESTIMATE_BLOCK = `
{{#if estimate}}
<h2>Estimate</h2>
<table>
  <thead>
    <tr>
      <th style="width: 38%;">Description</th>
      <th>Code</th>
      <th>Qty</th>
      <th>Unit</th>
      <th>Unit price</th>
      <th>Extended</th>
    </tr>
  </thead>
  <tbody>
    {{#each estimate.lines}}
    <tr>
      <td>{{description}}</td>
      <td>{{default code "&mdash;"}}</td>
      <td>{{number quantity}}</td>
      <td>{{unit}}</td>
      <td>{{usd unitPrice}}</td>
      <td>{{usd extended}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>

<div style="margin-top: 12pt; max-width: 60%;">
  <div class="totals-row"><span class="label">Subtotal</span><span>{{usd estimate.subtotal}}</span></div>
  <div class="totals-row"><span class="label">Overhead &amp; profit ({{percent estimate.overheadProfitRate}})</span><span>{{usd estimate.overheadProfit}}</span></div>
  <div class="totals-row"><span class="label">Subtotal w/ O&amp;P</span><span>{{usd estimate.subtotalWithOP}}</span></div>
  <div class="totals-row"><span class="label">Sales tax ({{percent estimate.salesTaxRate}})</span><span>{{usd estimate.salesTax}}</span></div>
  <div class="totals-row grand"><span class="label">Total</span><span>{{usd estimate.total}}</span></div>
</div>

<div class="summary-callout" style="margin-top: 18pt;">
  <h3 style="margin-top:0;">Payment terms</h3>
  <p>{{estimate.paymentTerms}}</p>
  <p style="margin-bottom:0;">
    Due at start: <strong>{{usd estimate.paymentSplit.atStart}}</strong>
    &middot;
    Due at completion: <strong>{{usd estimate.paymentSplit.atCompletion}}</strong>
  </p>
</div>
{{/if}}
`;

const SCOPE_BLOCK = `
{{#if job.scopeNotes}}
<h2>Scope of work</h2>
<p>{{job.scopeNotes}}</p>
{{/if}}
`;

// =============================================================================
// Per-report compositions
// =============================================================================

const WATER_MITIGATION_TEMPLATE = `${COVER_PAGE}
<section class="page">
  ${SCOPE_BLOCK}
  ${ROOMS_BLOCK}
  ${EQUIPMENT_BLOCK}
</section>
<section class="page">
  ${READINGS_BLOCK}
  ${DRYING_LOG_BLOCK}
</section>
<section class="page">
  ${PHOTOS_BLOCK}
  ${FORMS_BLOCK}
</section>`;

const FIRE_LOSS_TEMPLATE = `${COVER_PAGE}
<section class="page">
  ${SCOPE_BLOCK}
  ${ROOMS_BLOCK}
</section>
<section class="page">
  ${PHOTOS_BLOCK}
  ${FORMS_BLOCK}
</section>`;

const MOLD_REMEDIATION_TEMPLATE = `${COVER_PAGE}
<section class="page">
  ${SCOPE_BLOCK}
  ${ROOMS_BLOCK}
  ${READINGS_BLOCK}
</section>
<section class="page">
  ${PHOTOS_BLOCK}
  ${FORMS_BLOCK}
</section>`;

const PHOTO_REPORT_TEMPLATE = `${COVER_PAGE}
<section class="page">
  ${PHOTOS_BLOCK}
</section>`;

const MOISTURE_LOG_TEMPLATE = `${COVER_PAGE}
<section class="page">
  ${ROOMS_BLOCK}
  ${READINGS_BLOCK}
  ${DRYING_LOG_BLOCK}
</section>`;

const EQUIPMENT_LOG_TEMPLATE = `${COVER_PAGE}
<section class="page">
  ${EQUIPMENT_BLOCK}
</section>`;

const ESTIMATE_PROPOSAL_TEMPLATE = `${COVER_PAGE}
<section class="page">
  ${SCOPE_BLOCK}
  ${ESTIMATE_BLOCK}
</section>`;

const CONTENTS_INVENTORY_TEMPLATE = `${COVER_PAGE}
<section class="page">
  ${ROOMS_BLOCK}
  ${PHOTOS_BLOCK}
</section>`;

const CUSTOM_TEMPLATE = `${COVER_PAGE}
<section class="page">
  ${SCOPE_BLOCK}
  ${ROOMS_BLOCK}
  ${READINGS_BLOCK}
  ${DRYING_LOG_BLOCK}
  ${EQUIPMENT_BLOCK}
  ${PHOTOS_BLOCK}
  ${FORMS_BLOCK}
</section>`;

export const REPORT_TEMPLATES: Record<ReportType, string> = {
  WATER_MITIGATION: WATER_MITIGATION_TEMPLATE,
  FIRE_LOSS: FIRE_LOSS_TEMPLATE,
  MOLD_REMEDIATION: MOLD_REMEDIATION_TEMPLATE,
  PHOTO_REPORT: PHOTO_REPORT_TEMPLATE,
  MOISTURE_LOG: MOISTURE_LOG_TEMPLATE,
  EQUIPMENT_LOG: EQUIPMENT_LOG_TEMPLATE,
  ESTIMATE_PROPOSAL: ESTIMATE_PROPOSAL_TEMPLATE,
  CONTENTS_INVENTORY: CONTENTS_INVENTORY_TEMPLATE,
  CUSTOM: CUSTOM_TEMPLATE,
};

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  WATER_MITIGATION: "Water Mitigation Report",
  FIRE_LOSS: "Fire Loss Report",
  MOLD_REMEDIATION: "Mold Remediation Report",
  PHOTO_REPORT: "Photo Report",
  MOISTURE_LOG: "Moisture Log",
  EQUIPMENT_LOG: "Equipment Log",
  ESTIMATE_PROPOSAL: "Estimate Proposal",
  CONTENTS_INVENTORY: "Contents Inventory",
  CUSTOM: "Project Report",
};

export const LOSS_TYPE_LABELS: Record<string, string> = {
  WATER: "Water damage",
  FIRE: "Fire damage",
  MOLD: "Mold remediation",
  SMOKE: "Smoke damage",
  SEWAGE: "Sewage / Cat 3",
  STORM: "Storm damage",
  OTHER: "Other",
};
