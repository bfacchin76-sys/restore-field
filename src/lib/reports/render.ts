/**
 * Report renderer — Snapshot → HTML → letter PDF (Puppeteer).
 *
 * The renderer is split into two halves:
 *   - `renderReportHtml(snapshot)` returns the full HTML string. This is
 *     what tests exercise — Puppeteer's PDF binary isn't text-searchable.
 *   - `renderReportPdf(snapshot)` rasterises the HTML via Puppeteer and
 *     returns a Buffer. Browser launch is somewhat heavy (~1 s) so the
 *     queue worker keeps a single Browser alive across jobs.
 */

import "server-only";

import puppeteer, { type Browser } from "puppeteer";
import Handlebars from "handlebars";
import { logger } from "@/lib/logger";
import { formatUSD } from "@/lib/business/estimate";
import {
  LOSS_TYPE_LABELS,
  REPORT_FOOTER_TEMPLATE,
  REPORT_PAGE_CSS,
  REPORT_TEMPLATES,
  REPORT_TYPE_LABELS,
} from "./templates";
import type { ReportSnapshot } from "./types";

let helpersRegistered = false;
function registerHelpers() {
  if (helpersRegistered) return;
  helpersRegistered = true;

  Handlebars.registerHelper("date", (value: unknown) => {
    if (!value) return "";
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  });

  Handlebars.registerHelper("datetime", (value: unknown) => {
    if (!value) return "";
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  });

  Handlebars.registerHelper("default", (value: unknown, fallback: unknown) =>
    value == null || value === "" ? fallback : value,
  );

  Handlebars.registerHelper("number", (value: unknown) => {
    if (value == null || value === "") return "";
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  });

  Handlebars.registerHelper("usd", (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? formatUSD(n) : "";
  });

  Handlebars.registerHelper("percent", (value: unknown) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return `${(n * 100).toFixed(n * 100 < 10 ? 3 : 2).replace(/\.?0+$/, "")}%`;
  });

  Handlebars.registerHelper("join", (arr: unknown, sep: unknown) => {
    if (!Array.isArray(arr) || arr.length === 0) return "—";
    return arr.join(typeof sep === "string" ? sep : ", ");
  });

  Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);

  // Moisture-meter unit suffix.
  Handlebars.registerHelper("scaleUnit", (scale: unknown) => {
    switch (scale) {
      case "PERCENT_MC":
      case "PERCENT_WME":
        return "%";
      case "GPP":
        return "gpp";
      default:
        return "";
    }
  });

  // Color-coded reading status pill.
  Handlebars.registerHelper("readingStatus", (r: unknown) => {
    const reading = r as ReportSnapshot["readings"][number];
    if (reading.isDryGoal) return new Handlebars.SafeString('<span class="pill">Dry goal</span>');
    if (reading.isInitial) return "Initial";
    if (reading.isDry) return new Handlebars.SafeString('<span class="pill" style="background:#dcfce7;color:#166534;">Dry</span>');
    return "Drying";
  });

  // Combine T/RH/GPP triplet for the drying-log table cells.
  Handlebars.registerHelper(
    "psyc",
    (t: unknown, rh: unknown, gpp: unknown) => {
      const fmt = (n: unknown, suffix: string) =>
        n == null ? "—" : `${Number(n).toFixed(1)}${suffix}`;
      return `${fmt(t, "°F")} / ${fmt(rh, "%")} / ${fmt(gpp, " gpp")}`;
    },
  );

  Handlebars.registerHelper("byTypeList", (byType: unknown) => {
    if (!byType || typeof byType !== "object") return "—";
    const entries = Object.entries(byType as Record<string, number>).filter(
      ([, n]) => typeof n === "number" && n > 0,
    );
    if (entries.length === 0) return "—";
    return entries.map(([t, n]) => `${t}×${n}`).join(", ");
  });
}

const PAGE_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>{{reportTitle}}</title>
  <style>{{{css}}}</style>
</head>
<body>
{{{body}}}
</body>
</html>`;

export interface RenderOptions {
  /** Inject extra HTML into the cover page (e.g. user-supplied scope summary). */
  scopeSummary?: string;
  /** Override the report title shown on the cover. */
  titleOverride?: string;
}

export function renderReportHtml(
  snapshot: ReportSnapshot,
  opts: RenderOptions = {},
): string {
  registerHelpers();
  const tmpl = REPORT_TEMPLATES[snapshot.reportType];
  if (!tmpl) {
    throw new Error(`No template for report type ${snapshot.reportType}`);
  }
  const body = Handlebars.compile(tmpl)({
    ...snapshot,
    reportTypeLabel: REPORT_TYPE_LABELS[snapshot.reportType],
    reportTitle: opts.titleOverride ?? REPORT_TYPE_LABELS[snapshot.reportType],
    lossTypeLabel: LOSS_TYPE_LABELS[snapshot.job.lossType] ?? snapshot.job.lossType,
    scopeSummary: opts.scopeSummary ?? null,
  });
  return Handlebars.compile(PAGE_TEMPLATE)({
    reportTitle: opts.titleOverride ?? REPORT_TYPE_LABELS[snapshot.reportType],
    css: REPORT_PAGE_CSS,
    body,
  });
}

function renderFooterHtml(snapshot: ReportSnapshot): string {
  return Handlebars.compile(REPORT_FOOTER_TEMPLATE)({
    orgName: snapshot.org.name,
    licenseNumber: snapshot.org.licenseNumber,
    jobNumber: snapshot.job.jobNumber,
    generatedAt: new Date(snapshot.generatedAt).toLocaleDateString("en-US"),
  });
}

export async function renderReportPdf(
  snapshot: ReportSnapshot,
  opts: RenderOptions = {},
  externalBrowser?: Browser,
): Promise<Buffer> {
  registerHelpers();
  const html = renderReportHtml(snapshot, opts);
  const footerHtml = renderFooterHtml(snapshot);

  const browser =
    externalBrowser ??
    (await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    }));
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdf = await page.pdf({
      format: "letter",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0.5in", left: "0" },
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: footerHtml,
    });
    return Buffer.from(pdf);
  } catch (err) {
    logger.error({ err, reportType: snapshot.reportType }, "renderReportPdf failed");
    throw err;
  } finally {
    if (!externalBrowser) {
      await browser.close();
    }
  }
}
