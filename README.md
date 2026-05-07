# RestoreField

Self-hosted property-restoration field documentation app for 1-800 Water Damage of Nassau County. See [RESTOREFIELD_PRD.md](./RESTOREFIELD_PRD.md) for the full product/architecture spec.

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

### Without Docker

If Docker isn't available, you can run the same services natively. Make sure they listen on:

- Postgres on `localhost:5432` with database `restorefield`, user `restorefield`, password `restorefield` (and a `restorefield_shadow` DB for Prisma migrations).
- Redis on `localhost:6379`.
- MinIO on `localhost:9000` with bucket `restorefield`.

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
└── RESTOREFIELD_PRD.md       # Product + architecture spec
```

## Build phases

We're working through PRD §14 sequentially. Each phase has a "Definition of Done" — finish it before moving to the next.

- [x] Phase 0 — Project bootstrap
- [x] **Phase 1** — Auth & user management (you are here)
- [ ] Phase 2 — Job & Customer CRUD
- [ ] Phase 3 — Photos
- [ ] Phase 4 — Moisture readings & drying logs
- [ ] Phase 5 — Equipment
- [ ] Phase 6 — Sketching tool
- [ ] Phase 7 — Forms & e-signatures
- [ ] Phase 8 — Offline / PWA
- [ ] Phase 9 — Reports
- [ ] Phase 10 — Sharing, polish, deployment
- [ ] Phase 11 — Hardening
- [ ] Phase 12 — User testing & rollout
