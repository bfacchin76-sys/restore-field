import "server-only";
import type { Browser, Page, HTTPRequest } from "puppeteer";
import { logger } from "@/lib/logger";

/**
 * SSRF lockdown for the Puppeteer pages we use to render PDFs.
 *
 * PRD §11 task 6 — "SSRF in PDF generator" sits squarely on this code
 * path. The render pipeline only ever needs:
 *
 *   - the in-memory HTML string we pass to `page.setContent()`
 *   - data:/blob: URIs we embed in that HTML (photo data-URIs, signature
 *     PNGs)
 *   - about:blank navigations Puppeteer does internally
 *
 * Anything else — http(s), ftp, file:, ws — is a server-side fetch we
 * didn't authorise, so we abort the request. This blocks an attacker
 * who plants `<img src="http://internal-metadata/">` in a caption from
 * having Puppeteer exfiltrate AWS instance metadata or scan the LAN.
 */

const ALLOWED_SCHEMES = new Set(["data:", "blob:", "about:"]);

export async function lockDownPage(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (req: HTTPRequest) => {
    const url = req.url();
    const colon = url.indexOf(":");
    const scheme = colon >= 0 ? url.slice(0, colon + 1).toLowerCase() : "";
    if (ALLOWED_SCHEMES.has(scheme)) {
      void req.continue();
      return;
    }
    // Block-by-default. Log so an SOC can see attempts.
    logger.warn(
      { url: url.slice(0, 200), resourceType: req.resourceType() },
      "puppeteer-lockdown: blocked outbound fetch",
    );
    void req.abort("blockedbyclient");
  });
  // Disable JavaScript execution — our HTML is pure markup, and
  // disabling script eliminates a whole class of issues even if a
  // malicious user input slipped past Handlebars escaping.
  await page.setJavaScriptEnabled(false);
}

/**
 * Convenience wrapper: open a new page, lock it down, hand it to the
 * caller. Closes nothing — the caller manages the browser lifecycle.
 */
export async function newLockedPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await lockDownPage(page);
  return page;
}
