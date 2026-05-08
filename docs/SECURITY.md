# FieldRestore security notes

PRD §11 hardening artefacts. Update this doc when you fix a finding so
the audit trail stays in-tree.

## Pentest checklist

PRD §11 task 6: confirm IDOR, XSS, SSRF, file-upload type validation.
Each item lists the threat, the existing control, and how to verify.

### 1. IDOR (Insecure Direct Object Reference)

**Threat:** A signed-in user from Org A loads a Job/Photo/Report id that
belongs to Org B and reads/writes it.

**Controls:**

- Every Server Action / route handler resolves the resource and calls
  `assertCan(actor, action, resource)` against `src/lib/authz.ts`. The
  authz layer compares `resource.organizationId` to
  `actor.organizationId` *before* role/assignment checks.
- Page-level RSCs do the same: `if (!job || job.organizationId !==
  actor.organizationId) notFound()`.
- The `JobShare.token` table gates public links — non-bearer URLs
  return `notFound`.

**How to verify (manual):**

1. Create two orgs A + B, each with one OWNER and one TECH.
2. As Org A's TECH, capture a Job id from `/app/jobs/<jid>`.
3. As Org B's OWNER, hit `/app/jobs/<jid>`, `/api/reports/<rid>/pdf`
   for any of A's report ids, and `/share/<random-token>`. All three
   must return 404 / 403.
4. Repeat against the Server Action endpoints by submitting their
   form payloads from the wrong org session. Each must throw
   `Forbidden`.

### 2. XSS

**Threat:** User-supplied content (caption, scope notes, room name)
escapes its escaping context and runs as script.

**Controls:**

- All RSC + client component output goes through React's default
  escaping (no `dangerouslySetInnerHTML` in user-content paths).
- Handlebars (forms + reports) defaults to `noEscape: false`.
- CSP enforced at the Next layer (`next.config.ts`):
  - `default-src 'self'`
  - `script-src 'self' 'unsafe-inline'` — the `'unsafe-inline'` is for
    Next's hydration markers; nonce migration is a Phase 11.5 follow-up.
  - `frame-ancestors 'none'` blocks click-jacking.
- Photo `tags` and `caption` cap at the schema validator.

**How to verify:**

1. Submit `<script>alert(1)</script>` in: customer first name, room
   name, photo caption, scope notes, signed form free text. Reload —
   the literal string should appear in the DOM, no script execution.
2. View page source: confirm `Content-Security-Policy` header is set
   on all routes (curl `-I` + grep `content-security-policy`).
3. Run securityheaders.com against the production URL — expect A+.

### 3. SSRF in PDF generator

**Threat:** Attacker plants `<img src="http://169.254.169.254/...">` in
a free-text field; Puppeteer fetches it on the server, exfiltrating
metadata.

**Controls:** `src/lib/security/puppeteer-lockdown.ts`:

- `setRequestInterception(true)` aborts any non-`data:`/`blob:`/`about:`
  scheme.
- `setJavaScriptEnabled(false)` neutralises script-driven SSRF.
- All three Puppeteer call sites (reports/render.ts, forms/pdf.ts,
  business/sketch/export.ts) call `newLockedPage(browser)` instead of
  `browser.newPage()`.

**How to verify:**

1. Edit a job's `causeOfLoss` to:
   `<img src="http://169.254.169.254/latest/meta-data/">`.
2. Generate a Water Mitigation report.
3. Tail worker logs — expect a `puppeteer-lockdown: blocked outbound
   fetch` warning, no metadata in the resulting PDF.
4. Re-run with `<img src="data:image/png;base64,…">` — that one should
   render normally.

### 4. File-upload type validation

**Threat:** Attacker uploads a `.svg` or `.html` file with `Content-Type:
image/jpeg`; later it's served back inline and executes script.

**Controls:**

- `presignPhotoUploads` rejects MIME outside the
  `^image/(jpeg|png|webp|heic|heif|gif)$` allow-list.
- Storage adapter requires Content-Type and a max-size cap on the
  presigned URL (S3 enforces both at PUT time).
- The image worker (`src/lib/photos/process.ts`) re-sniffs format via
  Sharp's `metadata().format` and rejects anything not in
  `ALLOWED_IMAGE_FORMATS` (`jpeg|png|webp|gif|heif`). SVG is explicitly
  out — covered by `process.test.ts`.
- Photos are served via a presigned GET URL with a private cache; the
  Content-Type returned to browsers is the post-pipeline (WebP)
  derivative, not the original bytes.

**How to verify:**

1. Use curl + a real presigned URL to PUT an SVG with `Content-Type:
   image/jpeg`. The worker job should fail with "not an allowed photo
   type" and the photo row's `processingError` should reflect that.
2. Run `pnpm test src/lib/photos/process.test.ts` — the
   "rejects SVG bytes" + "rejects non-image bytes" tests cover the
   regression.

## Rate limiting + brute-force protection

PRD §11 tasks 1–2. See `src/lib/security/rate-limit.ts` and
`auth-throttle.ts`.

- Login: 5 attempts / 15 min per email **and** 10 / 15 min per IP.
- Password reset request: 5 / hour per email + 10 / 15 min per IP.
- Successful login clears the email counter so a slow user isn't
  punished by their own typos.

**Verify:**

1. Run `npx vitest run src/lib/security/rate-limit.test.ts` — all
   sliding-window cases green.
2. Manual: hit `/login` 6 times with bad creds → the 6th response
   should be `Too many sign-in attempts. Try again in N min.` and
   creds aren't checked against the DB.

## SAST

`pnpm audit --audit-level=low` — **0 known vulnerabilities** as of
2026-05-08. Re-run on every CI build; `pnpm.overrides` in
`package.json` pins:

- `postcss >= 8.5.10` (CVE-2025-… XSS via stringify)
- `nodemailer >= 8.0.5` (GHSA SMTP CRLF injection)
- `cookie >= 0.7.0` (GHSA-pxg6 OOB chars)

## Disaster recovery

PRD §11 task 7. The drill steps live in [README.md](../README.md) under
"Restore drill". Target RTO < 2 h.

Last drill: TODO date + outcome — fill in after first run.

## Load test

PRD §11 task 5. Script: `loadtest/k6-photo-upload.js`. Targets:

- p95 read endpoint < 2 s
- p95 photo upload < 5 s

Last run: TODO date + numbers — fill in after first run.

## Outstanding follow-ups

- CSP nonces for `script-src` (Phase 11.5 / Phase 12).
- WAF / IP-block-list at Caddy for repeat-offender IPs.
- Add `X-Frame-Options: DENY` to Caddy as belt-and-braces (currently
  set by Next; some upstream errors bypass).
