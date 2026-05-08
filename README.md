# FieldRestore

Self-hosted property-restoration field documentation app for 1-800 Water Damage of Nassau County. See [FIELDRESTORE_PRD.md](./FIELDRESTORE_PRD.md) for the full product/architecture spec.

## Tech stack

Next.js 16 (App Router) + TypeScript · Prisma 5 + PostgreSQL 16 · Auth.js v5 · Tailwind v4 + shadcn/ui · BullMQ + Redis · MinIO/R2 (S3-compatible) · Puppeteer · react-konva · Vitest + Playwright (later phases).

The full rationale lives in PRD §4. Don't deviate without updating the PRD first.

## Local development

### Prerequisites

- Node 20+ (tested on 22)
- pnpm 10+
- Docker + Docker Compose **or** native Postgres 16 + Redis 7 + MinIO

### First-time setup

```bash
# 1. Install JS deps
pnpm install

# 2. Bring up dev services (Postgres + Redis + MinIO)
docker compose -f docker-compose.dev.yml up -d

# 3. Copy env template
cp .env.example .env.local

# 4. Run migrations + seed
pnpm db:migrate
pnpm db:seed

# 5. Start the app
pnpm dev
```

Open <http://localhost:3000>. Phase 0 only renders an "alive" page that confirms the DB connection — login, jobs, etc. arrive in Phase 1+.

### Useful scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Run Next dev server (Turbopack) |
| `pnpm build` / `pnpm start` | Production build + serve |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | Run ESLint |
| `pnpm format` / `pnpm format:check` | Prettier write / check |
| `pnpm test` | Run Vitest once |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm db:migrate` | `prisma migrate dev` |
| `pnpm db:seed` | Run `prisma/seed.ts` |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm db:reset` | Drop + recreate dev DB |
| `pnpm worker` | Run the BullMQ image-process worker (long-lived; needs Redis) |

### Without Docker

If Docker isn't available, you can run the same services natively. Make sure they listen on:

- Postgres on `localhost:5432` with database `fieldrestore`, user `fieldrestore`, password `fieldrestore` (and a `fieldrestore_shadow` DB for Prisma migrations).
- Redis on `localhost:6379`.
- MinIO on `localhost:9000` with bucket `fieldrestore`.

Adjust `.env.local` if your local setup differs.

## Project layout

```
.
├── prisma/
│   ├── schema.prisma         # Single source of truth (PRD §6)
│   ├── seed.ts               # Idempotent seed: org + owner + sample equipment + form templates
│   └── migrations/
├── src/
│   ├── app/                  # Next.js App Router pages
│   ├── components/ui/        # shadcn/ui components (added per phase)
│   ├── lib/
│   │   ├── db.ts             # Prisma client singleton
│   │   └── utils.ts          # cn() class helper
│   └── hooks/
├── docker-compose.dev.yml    # Local Postgres/Redis/MinIO
├── .env.example              # Template — copy to .env.local
└── FIELDRESTORE_PRD.md       # Product + architecture spec
```

## Build phases

We're working through PRD §14 sequentially. Each phase has a "Definition of Done" — finish it before moving to the next.

- [x] Phase 0 — Project bootstrap
- [x] Phase 1 — Auth & user management
- [x] Phase 2 — Job & Customer CRUD
- [x] Phase 3 — Photos
- [x] Phase 4 — Moisture readings & drying logs
- [x] Phase 5 — Equipment
- [x] Phase 6 — Sketching tool
- [x] Phase 7 — Forms & e-signatures
- [x] Phase 8 — Offline / PWA
- [x] Phase 9 — Reports
- [x] Phase 10 — Sharing, polish, deployment
- [x] Phase 11 — Hardening
- [ ] **Phase 12** — User testing & rollout (see [docs/PHASE12_ROLLOUT.md](./docs/PHASE12_ROLLOUT.md))

## Production deployment runbook

Targets the PRD §13 single-VPS topology (Hetzner CX32, Ubuntu 24.04). The
same image runs both `app` and `worker` services; Caddy fronts them and
handles HTTPS automatically.

### One-time VPS setup

1. **Provision** a fresh Ubuntu 24.04 VPS with ≥4 vCPU / 8 GB RAM / 80 GB SSD.
2. **DNS:** Point `fieldrestore.example.com` (A record) at the VPS public IP.
3. **Install Docker:**
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER && newgrp docker
   ```
4. **Clone the repo and seed `.env`:**
   ```bash
   sudo mkdir -p /opt/fieldrestore && sudo chown $USER /opt/fieldrestore
   git clone https://github.com/bfacchin76-sys/restore-field.git /opt/fieldrestore
   cd /opt/fieldrestore
   cp .env.example .env
   # Fill in DOMAIN, NEXTAUTH_URL, AUTH_SECRET (openssl rand -base64 48),
   # POSTGRES_PASSWORD, S3_ACCESS_KEY/S3_SECRET_KEY (random hex), SMTP creds,
   # INITIAL_OWNER_EMAIL/INITIAL_OWNER_PASSWORD, RESTIC_REPOSITORY/PASSWORD.
   nano .env
   ```
5. **Boot the stack** (single command — PRD §10 DoD):
   ```bash
   docker compose pull   # if pulling a pre-built image from GHCR
   docker compose up -d
   ```
   First boot: the `app` container runs `prisma migrate deploy`, then runs
   the seed (only because no Organization exists yet) which creates the
   org, default form templates, and the OWNER user. Caddy obtains a TLS
   cert from Let's Encrypt automatically.

6. **Sign in once** at `https://<DOMAIN>` and immediately:
   - Change the OWNER password under **Account**.
   - Enable TOTP under **Account → Two-factor authentication**.
   - Verify org details under **Org** (estimate rates, license number).

### Day-2 deploys

- CI builds + pushes to `ghcr.io/bfacchin76-sys/restore-field:latest` on
  every push to `main`.
- On the VPS:
  ```bash
  cd /opt/fieldrestore
  docker compose pull
  docker compose up -d
  ```
  Migrations run automatically on container start (idempotent).

### Backups (Restic)

`docker/restic-backup.sh` dumps Postgres + the MinIO data dir into the
configured Restic repo, prunes to a 7d/4w/12m retention policy, and
runs `restic check --read-data-subset=5%` to verify integrity.

Run on demand:
```bash
docker compose --profile backup run --rm restic
```

Schedule via host cron (UTC):
```cron
0 2 * * *  /usr/bin/docker compose -f /opt/fieldrestore/docker-compose.yml --profile backup run --rm restic
```

#### Restore drill

Goal per PRD §11: rebuild on a fresh VPS in <2h.

1. New VPS, install Docker, clone repo, copy `.env` from password vault.
2. `docker compose --profile backup run --rm restic restic snapshots` →
   pick the latest snapshot id.
3. `restic restore <id> --target /tmp/dr/`.
4. `docker compose up -d postgres minio` → wait for healthcheck.
5. Restore Postgres: `psql $DATABASE_URL < /tmp/dr/postgres-dump.sql`.
6. Restore MinIO: `rsync -a /tmp/dr/data/minio/ ./minio_data/`.
7. `docker compose up -d`. Hit `/api/health` — expect `{"ok": true}`.
8. Open a known job, generate a report PDF, verify storage round-trips.

### Uptime monitoring

The compose stack includes an `app` healthcheck on `GET /api/health`
(returns 200 only when Postgres is reachable). For external probing pick
one:

- **Uptime Kuma** — self-host alongside (separate compose file, exposed
  via Caddy on `status.<DOMAIN>`). Probe `/api/health` every 60 s,
  alert via SMTP on 2 consecutive failures.
- **BetterStack / UptimeRobot** — point at `https://<DOMAIN>/api/health`;
  free tier covers a single endpoint.

PRD §11 will tighten this with full SLO dashboards.
