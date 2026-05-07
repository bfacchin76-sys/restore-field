import "server-only";
import sharp from "sharp";
import puppeteer from "puppeteer";
import { logger } from "@/lib/logger";
import { renderSceneSvg } from "./svg";
import { totalAreas } from "./scene";
import type { SketchScene } from "./types";

export interface ExportInput {
  scene: SketchScene;
  /** Job number / customer name shown at the top of the export. */
  title: string;
  /** Optional footer line (org name + date) shown bottom-left. */
  footer: string;
  /** "letter-landscape" → 11 × 8.5 in. Used for both PNG and PDF. */
  pageSize?: "letter-landscape";
}

export interface ExportPng {
  bytes: Buffer;
  width: number;
  height: number;
  dpi: number;
}

export interface ExportPdf {
  bytes: Buffer;
}

const LETTER_LANDSCAPE_IN = { width: 11, height: 8.5 };

/**
 * Render the scene's active floor as a PNG at the given DPI. We render
 * the SVG once via the in-process renderer, then rasterise with Sharp —
 * no Puppeteer needed for raster output. Sharp respects `density` for
 * SVG inputs so 2× DPI just doubles the rendering scale.
 */
export async function exportScenePng(
  input: ExportInput,
  dpi: 96 | 192,
): Promise<ExportPng> {
  const widthPx = Math.round(LETTER_LANDSCAPE_IN.width * dpi);
  const heightPx = Math.round(LETTER_LANDSCAPE_IN.height * dpi);
  const svg = renderSceneSvg(input.scene, {
    pageWidthPx: widthPx,
    pageHeightPx: heightPx,
    title: input.title,
    footer: appendTotalsFooter(input.footer, input.scene),
  });

  const png = await sharp(Buffer.from(svg, "utf8"), {
    density: dpi, // 96 = 1×, 192 = 2×
  })
    .png()
    .toBuffer();
  return { bytes: png, width: widthPx, height: heightPx, dpi };
}

/**
 * Render the scene as a PDF via Puppeteer. The page is letter-landscape
 * with the SVG inlined as background — the result imports cleanly into
 * Xactimate as an underlay image (PRD §12).
 */
export async function exportScenePdf(input: ExportInput): Promise<ExportPdf> {
  // Render to a high-DPI SVG for crisp PDF output.
  const widthPx = Math.round(LETTER_LANDSCAPE_IN.width * 144);
  const heightPx = Math.round(LETTER_LANDSCAPE_IN.height * 144);
  const svg = renderSceneSvg(input.scene, {
    pageWidthPx: widthPx,
    pageHeightPx: heightPx,
    title: input.title,
    footer: appendTotalsFooter(input.footer, input.scene),
  });

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<style>
  @page { size: ${LETTER_LANDSCAPE_IN.width}in ${LETTER_LANDSCAPE_IN.height}in; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  svg { width: ${LETTER_LANDSCAPE_IN.width}in; height: ${LETTER_LANDSCAPE_IN.height}in; display: block; }
</style>
</head>
<body>${svg}</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const buf = await page.pdf({
      width: `${LETTER_LANDSCAPE_IN.width}in`,
      height: `${LETTER_LANDSCAPE_IN.height}in`,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return { bytes: Buffer.from(buf) };
  } catch (err) {
    logger.error({ err }, "exportScenePdf failed");
    throw err;
  } finally {
    await browser.close();
  }
}

function appendTotalsFooter(footer: string, scene: SketchScene): string {
  const t = totalAreas(scene);
  const totals = t.totalSqFt
    ? `${t.totalSqFt.toFixed(0)} sq ft · ${t.totalLinearFt.toFixed(0)} lf`
    : "";
  if (footer && totals) return `${footer}  ·  ${totals}`;
  return footer || totals;
}
