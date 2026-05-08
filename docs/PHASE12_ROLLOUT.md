# Phase 12 — Field rollout playbook

PRD §14 says Phase 12 is *not* a coding phase: "Brian + 1-2 techs use the
app for real on 5 small water jobs in parallel with Encircle. Compare
output. Fix friction. Then commit to migration."

This doc is the runbook for that. Goal: end the phase confident enough
to cancel the Encircle subscription (PRD §2 success metric).

## Pre-flight (do this before you start the first job)

- [ ] **Production deploy is healthy**
  - `https://<DOMAIN>/api/health` returns `{"ok":true}`
  - `docker compose ps` — all five services `healthy` / `running`
  - Caddy obtained a real TLS cert (browser shows lock, no warning)
- [ ] **Owner account is locked down**
  - Initial password rotated under **Account → Profile**
  - TOTP enabled under **Account → Two-factor authentication**
  - Recovery code printed and stored in the password vault
- [ ] **Org settings filled in** (`/app/admin/org`)
  - License number (printed on every report PDF)
  - Sales tax rate confirmed (8.625% Nassau County default)
  - O&P rate confirmed (default 20%)
  - Report footer line ("1-800 Water Damage of Nassau County · phone")
- [ ] **Backup runs cleanly**
  - `docker compose --profile backup run --rm restic`
  - `restic snapshots` shows the snapshot
  - **Dry restore drill** to a scratch directory completed (don't skip
    — PRD §11 sets a < 2 h RTO that's only real if you've practised)
- [ ] **One full happy path rehearsed in staging or a test job**
  - Create job → add room → 1 photo → 1 reading → AOB form → Water
    Mitigation report → email share link to your own address →
    open the link in a private window. End-to-end takes ≤ 15 min.
- [ ] **Techs invited + onboarded**
  - Each tech has signed in once, set TOTP if applicable
  - Each has installed the PWA on their phone (Add to Home Screen)
  - Each has done a 5-minute walkthrough: photo capture, reading,
    note. Specifically show them the offline indicator (top-right
    sync chip).

## Pick the 5 pilot jobs

Bias toward simple, low-stakes jobs so a friction discovery doesn't
blow up an actual claim:

- **Loss types:** at least 3 water (your bread-and-butter), 1 mold,
  1 fire. Skip Cat 3 / sewage for v1 — too many novel surfaces at once.
- **Size:** under 4 affected rooms each. 1-2 days of drying.
- **Customer relationship:** existing repeat customers if possible —
  they'll forgive a re-shoot if a photo gets stuck in the queue.
- **Adjuster:** prefer an adjuster you've worked with before so the
  shared report PDF lands in front of someone who'll actually click it
  and tell you what's missing.

Document each one in a single tracker (Google Sheet works fine). For
each job:

| Column | Value |
|---|---|
| Job number | from FieldRestore |
| Encircle equivalent | from Encircle |
| Loss type | WATER / FIRE / MOLD |
| Lead tech | name |
| FieldRestore start | timestamp |
| Encircle start | timestamp |
| Friction notes | free text |
| Reports generated | counts |
| Adjuster response | when + what |

## Run the jobs in **parallel** with Encircle, not instead of

Per PRD: "in parallel with Encircle". The point is to compare, not to
gamble. Rules:

1. Every photo and reading captured in FieldRestore is also captured in
   Encircle (or vice versa) for at least the first 3 jobs. By job 4–5
   you can drop one if FieldRestore feels solid.
2. The carrier copy is whichever you have more confidence in **today**.
   Phase 12's job is to grow that confidence — don't burden the claim
   with the experiment.
3. If FieldRestore ever blocks completing a real-world step (sketches
   won't save, photo upload stuck, can't sign AOB), fall back to
   Encircle for the rest of that job and log it as a P1 friction.

## Daily check-in (5 minutes, every evening of an active job)

Run this against each pilot job. Skip days where nobody touched it.

**Tech, on phone:**

1. Did the app slow you down today? (Y/N + free text)
2. Was anything missing that Encircle has? (Y/N + which feature)
3. Did you have to re-shoot a photo because the app lost it? (Y/N +
   how many)
4. Did the offline → online sync ever look stuck? (Y/N + screenshot if
   yes — admin/sync page is where they go)
5. One sentence: would you use this app on the next job, gun to your
   head?

**Brian, at desk:**

6. Look at `/app/admin/sync` — any stuck items? Should be 0.
7. Spot-check `/app/jobs/<id>/activity` — every photo / reading /
   note has an audit row with the right user.
8. Open the latest generated report PDF. Side-by-side with the
   Encircle version, what's missing or weaker?
9. Check the worker logs: `docker compose logs --tail=200 worker`.
   Any `failed` lines? Any SSRF lockdown warnings (means a tech put
   a URL in a free-text field that Puppeteer rightly blocked)?
10. `docker compose --profile backup run --rm restic` — backup ran
    at midnight UTC; verify the snapshot exists and is < 24 h old.

## Friction log

One row per friction. Don't over-engineer this — a Google Doc with a
table works. The categories matter more than the format:

| Severity | Definition | Example |
|---|---|---|
| **P0** | Blocks completing the job in FieldRestore | Sketch editor crashes; photos stuck syncing for >24 h; report PDF won't generate |
| **P1** | Forces falling back to Encircle for this step | Can't enter a specific reading scale; CSV import drops a column |
| **P2** | Slower than Encircle but possible | Scrolling 100 photos lags; meter type list is missing one model |
| **P3** | Minor polish / wording | Button label confusing; date format inconsistency |

A friction is **fixed** when:
- It's reproduced (or confirmed un-reproducible) at the dev workstation
- A code change is committed + deployed
- The original tech has re-tried the flow on the next job

A friction is **wontfix-for-v1** when it's a P3 *and* the workaround
is faster to teach than to fix. Document the workaround in
[`docs/SECURITY.md`](./SECURITY.md) or a sibling doc so it doesn't
re-surface.

## Success criteria — when can we cancel Encircle?

All of:

- [ ] **5 jobs completed** end-to-end in FieldRestore (last reading
  taken, AOB + COC signed, reports generated, jobshare emailed to the
  adjuster).
- [ ] **No P0 frictions outstanding.** P1s either fixed or the
  workaround is documented and accepted by the lead tech.
- [ ] **All adjusters who received a FieldRestore PDF either signed
  off on it or the gap was closed in a follow-up.** No "can't read
  this format" rejections.
- [ ] **Zero data-loss incidents** (PRD §2 success metric). Defined as:
  no photo / reading / note was *captured by a tech but failed to
  appear in the final report*. Sync queue stuck items count if not
  manually cleared with the user's consent.
- [ ] **Backup + restore drill executed once during the pilot** (not
  just pre-flight) and verified bit-identical for at least one of the
  5 jobs.
- [ ] **Lead tech says yes** to: "If I lose Encircle access tomorrow,
  can I do my job?"

If any of those is `[ ]`, do not cancel Encircle. Run another 2-3 jobs
on whatever's still failing.

## Rollback / kill-switch

Two scenarios:

**Soft rollback** — FieldRestore is broken for one job:
1. Tell the tech: "Switch to Encircle for the rest of this job."
2. Mark the job CLOSED in FieldRestore with a note explaining.
3. File a P1 (or P0) in the friction log.
4. The data already in FieldRestore stays — for trend analysis.

**Hard rollback** — FieldRestore is broken for everyone:
1. SSH the VPS, `docker compose stop app worker` to make the URL
   return a clear 502 instead of corrupting state.
2. All techs revert to Encircle full-time.
3. Investigate via:
   - `/api/health` — is Postgres reachable?
   - `docker compose logs --tail=500 app worker postgres redis`
   - `docker compose --profile backup run --rm restic check` —
     is the repo healthy?
4. If recovery needs > 30 min, do a fresh deploy from the most recent
   git tag (the README runbook covers this — single command).
5. If Postgres is corrupted, follow the **Restore drill** in
   [`README.md`](../README.md). RTO target < 2 h.

If the hard rollback ever fires: that's the Phase 12 verdict — do
not cancel Encircle yet. Add a Phase 11.5 of targeted fixes against
whatever broke, then re-run the pilot from job 1.

## Phase 13 (post-rollout)

Not in the PRD, but worth budgeting time for during Phase 12 so the
findings turn into actual changes:

- Per-friction issue created in GitHub at the end of each week
- Phase 13 = one or two short cycles of friction fixes
- Cancel Encircle only after Phase 13 retrospect

## Owner sign-off

When the success criteria above all check, file a one-page retro:

```
FieldRestore pilot — sign-off, <date>

Jobs completed: 5
Frictions logged: <count>; outstanding: <count>
Carrier-accepted reports: <X / Y>
Backup drill: <pass/fail>
Lead tech vote: <yes/no>

Decision: cancel Encircle effective <date>.
```

Commit the retro to `docs/PHASE12_RETRO.md` so future-you (or the next
agent) has a record of how the migration went.
