# FieldRestore — Product Requirements & Architecture Spec

**Version:** 1.0
**Owner:** Brian Facchin (1-800 Water Damage of Nassau County)
**Target builder:** Claude Code (claude-opus-4-7) running locally
**Last updated:** May 6, 2026

-----

## 0. How to use this document

This is a build spec for an in-house clone of the field-documentation portion of Encircle, scoped to what a single restoration franchise actually uses every day. Hand this entire file to Claude Code and work through it section by section. Each numbered phase in **Section 14** is a self-contained chunk of work designed to fit a single Claude Code session.

If a build session times out, restart from the beginning of the most recent unfinished phase. Each phase has a stated "Definition of Done" — only move to the next phase when DoD is met.

When in doubt, prefer **boring, proven technology** over clever choices. This is a working app for a real business, not a portfolio piece.

-----

## 1. Executive Summary

FieldRestore is a self-hosted web application for documenting property-restoration jobs in the field. It replaces the field-documentation, sketching, moisture-tracking, equipment-tracking, and reporting features of Encircle for a single restoration franchise (initially 1-800 Water Damage of Nassau County, with multi-tenant capacity for future expansion to other businesses in the owner's portfolio).

**It does NOT clone:**

- Encircle's contents/packout module (v1 — may add in v2)
- Encircle's payment-on-site Stripe flow (use existing AR system)
- Encircle's direct Xactimate integration via Verisk's Property Data Request API (gated by Verisk; not legally available to single contractors)

**Xactimate handoff strategy:** Sketches export as high-resolution PNG/PDF with measurement labels, then get imported into Xactimate as **underlay images** (Estimate → Sketch → Options → Import → Import Underlay Image). Estimator traces over the underlay in Xactimate. This adds ~5 minutes per job versus Encircle's API push but costs $0/month vs. Encircle's $285+/month plus $10/import.

-----

## 2. Goals & Non-Goals

### Primary goals

1. Replace Encircle for **water/fire/mold mitigation field documentation** at 1-800 Water Damage Nassau County.
1. Run **fully self-hosted** on a single VPS or office server. No SaaS dependencies for core function.
1. Be **usable on a phone in the field with spotty signal** — offline-capable PWA that syncs when connection returns.
1. Generate **carrier-ready PDF reports** that match or exceed Encircle's quality.
1. Export sketches as **Xactimate-ready underlay images** with measurements visible.
1. Be **maintainable by a non-engineer + AI agent** (i.e., Brian + Claude Code) without a dedicated dev team.

### Non-goals (explicitly out of scope for v1)

- Native iOS/Android apps (PWA only)
- Direct Xactimate API integration
- Contents inventory / packout
- On-site Stripe payments
- Multi-language UI (English only)
- 3D scanning / LiDAR / Matterport-style capture
- AI-generated scope of work (defer to v2)
- White-labeling for resale

### Success metrics (12-month)

- 100% of Nassau County water/fire/mold jobs documented in FieldRestore
- Encircle subscription cancelled
- Report turnaround from job start to adjuster-ready PDF: <24 hours
- Zero data-loss incidents
- Field-tech adoption: every active tech uses it on every job

-----

## 3. Users & Roles

|Role             |Description                            |Permissions                                                                 |
|-----------------|---------------------------------------|----------------------------------------------------------------------------|
|**Owner**        |Brian / business owner                 |Full admin, billing, multi-tenant settings                                  |
|**Office Admin** |Coordinator, estimator                 |Create/edit/close jobs, generate reports, manage equipment, view all jobs   |
|**Lead Tech**    |Senior field tech                      |Create/edit own jobs and team jobs, take photos, sketches, moisture readings|
|**Tech**         |Field technician                       |Add photos/notes/readings to assigned jobs only                             |
|**Subcontractor**|Temporary field user                   |Time-limited access to specific jobs only                                   |
|**Read-only**    |Insurance adjuster, customer (optional)|View specific shared jobs only, no edits                                    |

Auth model: email + password with optional TOTP 2FA for Owner/Office Admin. Subcontractor invites via single-use magic link with expiration.

-----

## 4. Technology Stack

Chosen for: stability, large training corpus (so Claude Code writes it well), single-language full-stack, easy self-hosting.

### Core

- **Framework:** Next.js 15 (App Router) with TypeScript — full-stack React
- **Runtime:** Node.js 20 LTS
- **Database:** PostgreSQL 16 (single instance, daily backup)
- **ORM:** Prisma 5.x
- **Auth:** Auth.js v5 (NextAuth) with credentials provider + email magic links
- **Styling:** Tailwind CSS v4 + shadcn/ui components
- **Forms:** React Hook Form + Zod schemas
- **Client state:** TanStack Query (React Query) v5
- **Server state:** Next.js Server Actions for mutations, RSC for reads
- **Validation:** Zod everywhere (shared between client and server)

### Specialized

- **File storage:** MinIO (S3-compatible) self-hosted, OR Cloudflare R2 (cheap S3-compatible) — pick at deploy
- **Image processing:** Sharp (resize, EXIF strip on demand, watermark)
- **PDF generation:** Puppeteer with HTML templates — flexible and high-quality
- **Sketch canvas:** react-konva (Konva.js) — battle-tested 2D canvas, good touch support
- **Charts:** Recharts (for moisture trend graphs)
- **Maps (optional):** Leaflet + OpenStreetMap (no API key needed)
- **Background jobs:** BullMQ + Redis (image processing, PDF generation, email sending)
- **Email:** Resend OR self-hosted SMTP via Postal — pick at deploy
- **Observability:** Pino structured logging + a simple log file viewer in admin

### Mobile/PWA

- **PWA shell:** next-pwa or custom service worker
- **Offline storage:** IndexedDB via Dexie.js
- **Sync queue:** Custom sync layer using TanStack Query mutation queue persistence
- **Camera:** native `<input type="file" accept="image/*" capture="environment">` for v1, with `getUserMedia` upgrade path

### Infrastructure

- **Reverse proxy:** Caddy 2 (auto-HTTPS via Let's Encrypt)
- **Process manager:** Docker Compose (everything containerized)
- **Backups:** Restic to off-site S3-compatible bucket, nightly
- **Monitoring:** Uptime Kuma (self-hosted)

### Why these choices

- Next.js + TypeScript + Prisma is the most-trained-on full-stack combo. Claude Code writes it accurately and idiomatically.
- All choices have years of production track record. No bleeding-edge bets.
- Everything runs in Docker Compose — single `docker compose up` to deploy.
- No vendor lock-in: PostgreSQL data is portable, MinIO files are portable, app is open-source code you own.

-----

## 5. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User devices                             │
│  Field tech phones (PWA)    Office laptops    Adjuster browsers │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTPS (Caddy auto-cert)
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Caddy reverse proxy                            │
│   - TLS termination                                              │
│   - HTTP→HTTPS redirect                                          │
│   - Static asset caching                                         │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              Next.js app (Node 20, port 3000)                   │
│   - SSR / RSC pages                                              │
│   - Server Actions (mutations)                                   │
│   - API routes (/api/*) for mobile-only or webhook endpoints     │
│   - Auth.js session handling                                     │
└─────┬────────────────────┬───────────────────────┬───────────────┘
      │                    │                       │
      ▼                    ▼                       ▼
┌──────────┐      ┌────────────────┐      ┌──────────────────────┐
│PostgreSQL│      │  MinIO (S3)    │      │  Redis + BullMQ      │
│   :5432  │      │     :9000      │      │     :6379            │
│          │      │  - photos/     │      │  - image-resize jobs │
│          │      │  - reports/    │      │  - pdf-generate jobs │
│          │      │  - sketches/   │      │  - email-send jobs   │
│          │      │  - exports/    │      │                      │
└──────────┘      └────────────────┘      └──────────────────────┘
                                                    │
                                                    ▼
                                          ┌────────────────────┐
                                          │  Worker process    │
                                          │  (same Next.js     │
                                          │  image, different  │
                                          │  entrypoint)       │
                                          └────────────────────┘
```

**Deployment model:** All services in a single `docker-compose.yml` running on one VPS (recommended: Hetzner CX32 — 4 vCPU, 8GB RAM, ~$8/month, plenty for one franchise).

**Network:** All inter-service traffic on a private Docker network. Only Caddy is exposed to the public internet (ports 80/443).

**Storage planning:**

- ~50MB photos per job × 1000 jobs/year = 50GB/year → need 200GB+ disk
- PostgreSQL: <10GB/year
- Backups: 2x storage minimum

-----

## 6. Data Model (Prisma Schema)

This schema is the source of truth. Implement it exactly as specified before building features.

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// =======================================================
// TENANCY & USERS
// =======================================================

model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  // Branding for reports
  logoUrl       String?
  primaryColor  String   @default("#1e3a8a") // dark blue default per Brian's spec
  reportFooter  String?  // e.g., "1-800 Water Damage of Nassau County | License #..."
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  users      User[]
  jobs       Job[]
  customers  Customer[]
  equipment  Equipment[]
  formTemplates FormTemplate[]
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String?
  name          String
  phone         String?
  role          Role      @default(TECH)
  active        Boolean   @default(true)
  totpSecret    String?
  lastLoginAt   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])

  // Activity
  jobsCreated      Job[]            @relation("JobCreator")
  jobsAssigned     JobAssignment[]
  photosUploaded   Photo[]
  notesCreated     Note[]
  readingsTaken    MoistureReading[]
  signaturesGiven  Signature[]
  reportsGenerated Report[]
  auditLogs        AuditLog[]

  @@index([organizationId])
}

enum Role {
  OWNER
  OFFICE_ADMIN
  LEAD_TECH
  TECH
  SUBCONTRACTOR
  READ_ONLY
}

// =======================================================
// JOBS (the central entity)
// =======================================================

model Customer {
  id           String   @id @default(cuid())
  organizationId String
  organization Organization @relation(fields: [organizationId], references: [id])

  firstName    String
  lastName     String
  email        String?
  phone        String?
  // Property address (the loss location)
  addressLine1 String
  addressLine2 String?
  city         String
  state        String   @default("NY")
  postalCode   String
  // Insurance info
  insuranceCarrier String?
  policyNumber     String?
  claimNumber      String?
  adjusterName     String?
  adjusterEmail    String?
  adjusterPhone    String?

  jobs         Job[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([organizationId])
  @@index([lastName, firstName])
}

model Job {
  id              String      @id @default(cuid())
  jobNumber       String      // e.g., "1800WD-2026-0142" — auto-generated, unique per org
  organizationId  String
  organization    Organization @relation(fields: [organizationId], references: [id])

  customerId      String
  customer        Customer    @relation(fields: [customerId], references: [id])

  lossType        LossType
  status          JobStatus   @default(DRAFT)
  lossDate        DateTime?
  firstResponseAt DateTime?
  closedAt        DateTime?

  // Brief description of the cause
  causeOfLoss     String?
  // Free-form scope notes
  scopeNotes      String?     @db.Text

  createdById     String
  createdBy       User        @relation("JobCreator", fields: [createdById], references: [id])
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  // Relations
  rooms           Room[]
  photos          Photo[]
  notes           Note[]
  readings        MoistureReading[]
  dryingLogs      DryingLog[]
  equipmentPlacements EquipmentPlacement[]
  sketches        Sketch[]
  formSubmissions FormSubmission[]
  reports         Report[]
  assignments     JobAssignment[]
  shares          JobShare[]
  auditLogs       AuditLog[]

  @@unique([organizationId, jobNumber])
  @@index([organizationId, status])
  @@index([customerId])
}

enum LossType {
  WATER
  FIRE
  MOLD
  SMOKE
  SEWAGE
  STORM
  OTHER
}

enum JobStatus {
  DRAFT
  ACTIVE
  DRYING
  COMPLETE
  ON_HOLD
  CLOSED
  CANCELLED
}

model JobAssignment {
  id        String   @id @default(cuid())
  jobId     String
  job       Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  role      String   // "lead", "tech", "estimator", etc.
  assignedAt DateTime @default(now())

  @@unique([jobId, userId])
}

// Time-limited share for adjusters / customers
model JobShare {
  id          String   @id @default(cuid())
  jobId       String
  job         Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  recipientEmail String
  token       String   @unique  // unguessable
  expiresAt   DateTime
  permissions Json     // e.g. { canViewPhotos: true, canViewReports: true }
  createdAt   DateTime @default(now())
  lastUsedAt  DateTime?
  revoked     Boolean  @default(false)
}

// =======================================================
// ROOMS & PHOTOS
// =======================================================

model Room {
  id        String   @id @default(cuid())
  jobId     String
  job       Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  name      String   // "Kitchen", "Master Bedroom", etc.
  floor     String?  // "1st floor", "Basement"
  // Optional measurements (manual entry)
  lengthFt  Float?
  widthFt   Float?
  heightFt  Float?   @default(8.0)
  // Affected materials
  affectedMaterials Json?  // ["drywall", "carpet", "subfloor"]
  category   WaterCategory? // for water losses: 1, 2, 3
  classOfLoss WaterClass?   // 1-4
  notes      String?  @db.Text
  sortOrder  Int      @default(0)

  photos       Photo[]
  readings     MoistureReading[]
  equipmentPlacements EquipmentPlacement[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([jobId])
}

enum WaterCategory {
  CAT_1
  CAT_2
  CAT_3
}

enum WaterClass {
  CLASS_1
  CLASS_2
  CLASS_3
  CLASS_4
}

model Photo {
  id           String   @id @default(cuid())
  jobId        String
  job          Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  roomId       String?
  room         Room?    @relation(fields: [roomId], references: [id], onDelete: SetNull)

  storageKey   String   // S3 key, e.g. "org_xxx/job_yyy/photo_zzz_original.jpg"
  thumbnailKey String?  // smaller version for fast loading
  mimeType     String
  sizeBytes    Int
  width        Int?
  height       Int?

  // EXIF / metadata
  takenAt      DateTime?
  gpsLat       Float?
  gpsLng       Float?
  deviceModel  String?

  // User input
  caption      String?
  tags         String[] @default([])
  // For fire-loss workflow: salvageability rating
  salvageability Salvageability?

  uploadedById String
  uploadedBy   User     @relation(fields: [uploadedById], references: [id])
  createdAt    DateTime @default(now())

  @@index([jobId])
  @@index([roomId])
  @@index([takenAt])
}

enum Salvageability {
  SALVAGEABLE
  UNSALVAGEABLE
  REQUIRES_PROFESSIONAL_CLEANING
  PENDING_REVIEW
}

model Note {
  id        String   @id @default(cuid())
  jobId     String
  job       Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  content   String   @db.Text
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  createdAt DateTime @default(now())

  @@index([jobId])
}

// =======================================================
// MOISTURE & DRYING (Hydro equivalent)
// =======================================================

model MoistureReading {
  id            String   @id @default(cuid())
  jobId         String
  job           Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  roomId        String?
  room          Room?    @relation(fields: [roomId], references: [id], onDelete: SetNull)

  // What was measured
  surface       String   // "Drywall - North Wall", "Subfloor", "Hardwood floor"
  material      Material
  meterType     MeterType
  // Reading values
  moistureValue Float    // %MC for invasive/pin, %WME for non-invasive
  // For non-invasive meters that report relative scale:
  scaleType     ScaleType @default(PERCENT_MC)

  // Environmental conditions at time of reading
  ambientTempF  Float?
  ambientRH     Float?

  // Drying status
  isDryGoal     Boolean  @default(false)  // mark this as the dry-standard target
  isInitial     Boolean  @default(false)  // first reading on a surface
  isDry         Boolean  @default(false)  // surface confirmed dry

  // Notes & photo
  notes         String?
  photoId       String?

  takenById     String
  takenBy       User     @relation(fields: [takenById], references: [id])
  takenAt       DateTime @default(now())

  @@index([jobId, takenAt])
  @@index([roomId])
}

enum Material {
  DRYWALL
  PLASTER
  WOOD_FRAMING
  HARDWOOD
  ENGINEERED_WOOD
  LAMINATE
  CONCRETE
  CARPET
  CARPET_PAD
  SUBFLOOR_OSB
  SUBFLOOR_PLYWOOD
  TILE
  INSULATION
  CABINETRY
  OTHER
}

enum MeterType {
  PIN
  PINLESS
  THERMO_HYGROMETER
  IR_CAMERA
}

enum ScaleType {
  PERCENT_MC          // Pin meters, % moisture content
  PERCENT_WME         // Pinless, wood moisture equivalent
  RELATIVE_SCALE      // 0-100 relative
  GPP                 // grains per pound (for psychrometric)
}

model DryingLog {
  id           String   @id @default(cuid())
  jobId        String
  job          Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  logDate      DateTime
  // Psychrometric readings — outside, unaffected, affected, HVAC
  outsideTempF Float?
  outsideRH    Float?
  outsideGPP   Float?
  unaffectedTempF Float?
  unaffectedRH    Float?
  unaffectedGPP   Float?
  affectedTempF   Float?
  affectedRH      Float?
  affectedGPP     Float?
  hvacTempF       Float?
  hvacRH          Float?
  hvacGPP         Float?
  // Free-form
  techNotes    String?  @db.Text
  recordedById String
  createdAt    DateTime @default(now())

  @@index([jobId, logDate])
}

// =======================================================
// EQUIPMENT
// =======================================================

model Equipment {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])

  assetTag       String   @unique  // e.g., "AM-024" (air mover #24)
  type           EquipmentType
  manufacturer   String?
  model          String?
  serialNumber   String?
  // Technical specs
  amperage       Float?   // for billing power consumption
  cfm            Int?     // air movers
  ppd            Int?     // dehumidifier pints per day
  status         EquipmentStatus @default(AVAILABLE)
  notes          String?
  purchasedAt    DateTime?

  placements     EquipmentPlacement[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([organizationId, type, status])
}

enum EquipmentType {
  AIR_MOVER
  DEHUMIDIFIER_LGR
  DEHUMIDIFIER_REFRIGERANT
  DEHUMIDIFIER_DESICCANT
  AIR_SCRUBBER_HEPA
  HEATER
  OZONE
  HYDROXYL
  THERMAL_FOGGER
  DRYING_MAT
  OTHER
}

enum EquipmentStatus {
  AVAILABLE
  DEPLOYED
  MAINTENANCE
  RETIRED
}

model EquipmentPlacement {
  id          String   @id @default(cuid())
  jobId       String
  job         Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  roomId      String?
  room        Room?    @relation(fields: [roomId], references: [id], onDelete: SetNull)
  equipmentId String
  equipment   Equipment @relation(fields: [equipmentId], references: [id])
  placedAt    DateTime @default(now())
  removedAt   DateTime?
  notes       String?

  @@index([jobId])
  @@index([equipmentId, removedAt])
}

// =======================================================
// SKETCHES
// =======================================================

model Sketch {
  id          String   @id @default(cuid())
  jobId       String
  job         Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  name        String   // "Main Floor", "Basement", etc.
  // Vector data for editing — JSON Konva scene
  sceneData   Json
  // Last rendered raster export (for fast PDF embedding)
  pngStorageKey String?
  pdfStorageKey String?
  // Calculated areas
  totalSqFt   Float?
  totalLinearFt Float?
  // Versioning
  version     Int      @default(1)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([jobId])
}

// =======================================================
// FORMS & SIGNATURES
// =======================================================

model FormTemplate {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  name           String   // "Authorization to Perform Services", "Certificate of Completion"
  // Schema: JSON describing fields (label, type, required, etc.)
  schema         Json
  // HTML template with Handlebars-style {{placeholders}}
  bodyTemplate   String   @db.Text
  active         Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  submissions    FormSubmission[]

  @@index([organizationId])
}

model FormSubmission {
  id             String   @id @default(cuid())
  jobId          String
  job            Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  templateId     String
  template       FormTemplate @relation(fields: [templateId], references: [id])
  // Filled values keyed by field id
  values         Json
  // Final rendered HTML/PDF for archive
  renderedPdfKey String?
  signatures     Signature[]
  status         FormStatus @default(DRAFT)
  sentToEmail    String?
  sentAt         DateTime?
  completedAt    DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([jobId])
}

enum FormStatus {
  DRAFT
  SENT
  PARTIALLY_SIGNED
  COMPLETED
  EXPIRED
}

model Signature {
  id              String   @id @default(cuid())
  formSubmissionId String
  formSubmission  FormSubmission @relation(fields: [formSubmissionId], references: [id], onDelete: Cascade)
  signerName      String
  signerEmail     String?
  signerRole      String   // "Customer", "Tech", "Insured"
  // Signature image as base64 PNG
  signatureDataUrl String  @db.Text
  // Audit
  signedAt        DateTime @default(now())
  ipAddress       String?
  userAgent       String?
  // If the signer was a logged-in user, link them
  userId          String?
  user            User?    @relation(fields: [userId], references: [id])

  @@index([formSubmissionId])
}

// =======================================================
// REPORTS
// =======================================================

model Report {
  id           String   @id @default(cuid())
  jobId        String
  job          Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  type         ReportType
  // Generated PDF storage
  pdfStorageKey String
  // Snapshot of data at generation time (for legal defensibility)
  dataSnapshot Json
  // Settings used
  config       Json     // e.g., { includeReadings: true, includePhotos: true }
  generatedById String
  generatedBy   User    @relation(fields: [generatedById], references: [id])
  generatedAt  DateTime @default(now())

  @@index([jobId, type])
}

enum ReportType {
  WATER_MITIGATION
  FIRE_LOSS
  MOLD_REMEDIATION
  CONTENTS_INVENTORY  // future
  PHOTO_REPORT
  MOISTURE_LOG
  EQUIPMENT_LOG
  ESTIMATE_PROPOSAL   // for the Nassau-County Xactimate-style proposal
  CUSTOM
}

// =======================================================
// AUDIT LOG (legal defensibility)
// =======================================================

model AuditLog {
  id        String   @id @default(cuid())
  jobId     String?
  job       Job?     @relation(fields: [jobId], references: [id], onDelete: SetNull)
  userId    String?
  user      User?    @relation(fields: [userId], references: [id])
  action    String   // "photo.upload", "reading.create", "report.generate", "share.create"
  details   Json
  ipAddress String?
  userAgent String?
  createdAt DateTime @default(now())

  @@index([jobId, createdAt])
  @@index([userId, createdAt])
}
```

### Migration & seeding

- Run `prisma migrate dev` to bootstrap schema in dev.
- Provide a `prisma/seed.ts` that creates one organization, an OWNER user (use ENV vars for initial credentials), three sample equipment items, and two default form templates ("Authorization to Perform Services" and "Certificate of Completion").

-----

## 7. Authentication & Authorization

### Auth flows

1. **Email + password login** for all internal users (Owner, Office Admin, Lead Tech, Tech).
1. **TOTP 2FA optional** but enforced for Owner and Office Admin via setting toggle.
1. **Magic-link login** for subcontractors and read-only adjusters/customers — single-use, 7-day expiry.
1. **Session persistence:** HTTP-only cookies, 30-day rolling expiration, refresh on activity.
1. **Password reset:** standard email-based flow with single-use token, 1-hour expiry.

### Authorization rules

Implement as a single `can(user, action, resource)` helper used in both Server Actions and RSC pages. Examples:

```ts
can(user, 'job.create', org)            // OWNER, OFFICE_ADMIN, LEAD_TECH only
can(user, 'job.delete', job)            // OWNER, OFFICE_ADMIN only
can(user, 'job.view', job)              // any user assigned to it OR OWNER/OFFICE_ADMIN
can(user, 'photo.upload', job)          // any assigned user
can(user, 'report.generate', job)       // OWNER, OFFICE_ADMIN, LEAD_TECH
can(user, 'equipment.manage', org)      // OWNER, OFFICE_ADMIN
can(user, 'user.invite', org)           // OWNER, OFFICE_ADMIN
can(user, 'org.settings', org)          // OWNER only
```

Subcontractors must have an explicit `JobAssignment` to access a job. Read-only shares pass through `JobShare.token` and bypass the user model entirely (no user account needed).

### Audit logging

Every mutation that touches a Job must write to `AuditLog`. Wrap Server Actions in a `withAudit()` helper that captures user, action, resource, before/after diff (where useful), IP, and user agent.

-----

## 8. Feature Specifications

### 8.1 Jobs (the home base)

**Job creation flow:**

1. User taps "New Job" from dashboard.
1. Required: customer (search existing or create new), loss type, loss date.
1. Auto-generated `jobNumber` format: `{org-prefix}-{year}-{sequence:04d}` — e.g., `1800WD-2026-0142`.
1. Org-prefix is configurable in org settings.
1. Job lands in `DRAFT` status. Becomes `ACTIVE` on first photo or reading.

**Jobs list view (mobile + desktop):**

- Default sort: most recently updated first.
- Filter chips: status (All / Active / Drying / Complete), loss type, my jobs vs. all jobs.
- Search by customer name, address, claim number, job number.
- Each card shows: job number, customer name, address, loss type icon, status badge, last activity, photo count, lead tech.
- Tap → job detail.

**Job detail view (tabbed):**

- Overview (customer info, dates, scope notes, assigned team)
- Rooms (list of rooms, tap to enter)
- Photos (gallery view, filter by room)
- Moisture (table + chart of readings)
- Drying log (one row per day)
- Equipment (currently deployed equipment)
- Sketches (list with thumbnails)
- Forms (list of submissions)
- Reports (list of generated reports, "Generate New" button)
- Activity (audit log)

### 8.2 Photo capture & documentation

**The single most important feature.** Must work flawlessly offline.

**Capture flow:**

1. User opens job, taps "Add Photos" from any tab.
1. Native file picker with camera capture (`<input capture="environment">`).
1. Multi-select supported.
1. After capture, user assigns each photo to a room (default to last-used room).
1. Optional: caption, tags, salvageability rating (for fire jobs).
1. Photos upload in background. UI shows queue with retry on failure.

**Storage rules:**

- Original photo stored at `s3://{bucket}/{orgId}/{jobId}/{photoId}/original.{ext}`.
- On upload, background job creates 3 sizes:
  - `thumb.webp` — 320px max edge, ~80% quality (for grid views)
  - `medium.webp` — 1280px max edge, ~85% quality (for report embedding)
  - `original.{ext}` — untouched, full resolution (for legal defensibility)
- EXIF preserved on original. Stripped on derivatives by default.
- GPS coordinates extracted from EXIF and stored on Photo record (for proof of location).

**Gallery features:**

- Grid view (3 cols mobile, 6 cols desktop) with lazy loading.
- Lightbox with swipe navigation, caption editing, tag editing.
- Filter by: room, salvageability, tags, date range.
- Bulk operations: assign to room, add tags, set salvageability, delete (with confirm).
- Per the project memory: **for fire jobs**, salvageability auto-rules:
  - Soft goods/fabric items → unsalvageable
  - Hard surfaces warped/burned → unsalvageable
  - Electronics → "requires professional cleaning"
  - All other intact hard surfaces → salvageable
  - Apply via "Auto-classify" button using user-assigned tags as input.

**Filename rule (per Brian's preference):** Exported photos use `{description}_{salvageability}.{ext}`, NOT batch-numbered.

### 8.3 Sketching tool (the technically hardest piece)

**Goal:** Produce a clean floor-plan PNG/PDF with measurements visible, suitable for use as Xactimate underlay.

**Editor canvas (react-konva):**

- Infinite-pan, pinch-zoom, snap-to-grid (default 6" grid).
- Toolbar: Select / Wall / Door / Window / Opening / Stairs / Label / Dimension / Eraser.
- Wall tool: click-click-click polyline, double-click to close polygon → creates Room shape.
- Walls auto-snap to existing wall endpoints within 12px.
- Doors: 32" default width, drag along wall, swing direction toggle.
- Windows: 36" default width × 48" height, drag along wall, sill height editable.
- Each room polygon shows: room name (editable), area in sqft, perimeter in linear feet.
- Each wall shows length label, toggleable.
- Multi-floor support: tabs at top for "Floor 1", "Basement", "Floor 2", etc.

**Data model:**

- Scene stored as JSON in `Sketch.sceneData`. Schema:
  
  ```ts
  type SketchScene = {
    floors: Array<{
      id: string;
      name: string;
      walls: Array<{ id: string; points: number[]; thickness: number }>;
      rooms: Array<{
        id: string;
        name: string;
        wallIds: string[];      // closed polygon
        ceilingHeightFt: number;
        materials?: { floor?: string; walls?: string; ceiling?: string };
      }>;
      doors: Array<{ id: string; wallId: string; positionAlongWall: number; widthIn: number; swing: 'left'|'right' }>;
      windows: Array<{ id: string; wallId: string; positionAlongWall: number; widthIn: number; heightIn: number; sillHeightIn: number }>;
      labels: Array<{ id: string; x: number; y: number; text: string; fontSize: number }>;
      dimensions: Array<{ id: string; from: [number,number]; to: [number,number]; offset: number }>;
    }>;
    scale: { pixelsPerFoot: number };
    units: 'imperial' | 'metric';
  };
  ```

**Export options:**

- **PNG** (1x and 2x DPI) — for Xactimate underlay. Include all measurements, room labels, scale bar, north arrow.
- **PDF** (letter, landscape, multi-page if multiple floors) — same content, vector where possible.
- Export endpoint: `POST /api/sketches/:id/export?format=png|pdf&dpi=1|2`
- Server-side rendering via Puppeteer rendering an HTML page that uses the same Konva scene → preserves visual fidelity and gives crisp text.

**v1 scope decision:** Manual drawing only. NO smartphone-video room-scanning (Encircle's killer feature requires custom CV pipeline — defer to v2). The compromise: in the field, technician takes a few quick reference photos and a sketch on paper, then enters the sketch in the app at the desk. Since estimator still has to trace into Xactimate anyway, this is the right tradeoff for v1.

**v2 idea (do NOT build now):** Room-scan via phone — record a slow walk-through, run RoomPlan API on iOS via a tiny native shim, or use a hosted CV service like CubiCasa.

### 8.4 Moisture readings & drying logs

**Reading entry (mobile-optimized):**

- One-tap entry from job page or room page.
- Form: room (default last), surface (free text + autocomplete from prior readings on this job), material, meter type, value, optional photo of meter, notes.
- Conditions auto-fill from most recent DryingLog that day if available.
- Mark as "dry goal" (the target) on first reading; subsequent readings auto-flag dry when ≤ goal.

**Reading visualization:**

- Per-surface time-series line chart (Recharts).
- Y-axis: %MC. X-axis: time. Threshold line for dry goal.
- Color: red above goal, green at/below.
- Filter by room.

**Drying log:**

- One row per day, four columns of readings (outside / unaffected / affected / HVAC).
- Each cell: Temp °F / RH% / GPP.
- GPP auto-calculated from temp + RH if not entered (use psychrometric formula).
- Tech notes free text.
- Auto-create today's row if any moisture reading is taken with no log for today.

**IICRC alignment:**

- For water Cat 2/3, recommend equipment based on affected sqft (basic table — defer full S500 calculator to v2).
- Display warnings: "Surface X has not reached dry goal for Y days" once Y > 5.

### 8.5 Equipment tracking

**Equipment master list (org-level):**

- Settings → Equipment → grid of all owned equipment with status, current job, last service.
- Add/edit/retire equipment.
- Bulk import via CSV.

**Per-job placement:**

- Job → Equipment tab → "Place Equipment".
- Select equipment from available pool (filtered by status=AVAILABLE).
- Assign to specific room.
- Equipment auto-marked DEPLOYED.
- "Remove" sets `removedAt`, returns to AVAILABLE pool.
- Daily count auto-snapshot at midnight for billing-day calculations.

**Reports:**

- Equipment placement timeline (Gantt-style chart).
- Daily equipment count summary for invoice justification.
- Equipment utilization report (org-wide: which assets are deployed how often).

### 8.6 Forms & e-signatures

**Form templates (org-level):**

- Library of common restoration forms. Ship with two defaults:
1. Authorization to Perform Services (AOB)
1. Certificate of Completion (COC)
- Templates use Handlebars-style placeholders: `{{customer.firstName}}`, `{{job.jobNumber}}`, `{{loss.date}}`, etc.
- Schema defines fillable fields with type (text, date, signature).

**Sending a form:**

- From job → Forms tab → "Send Form" → pick template.
- Pre-fill from job/customer data.
- Send via email (link with magic token) OR generate in-person signing flow.
- Recipient lands on form page → reviews → signs (canvas signature pad) → submits.
- Final PDF generated and attached to job.

**Signature requirements:**

- Capture: name, signature image (PNG data URL), timestamp, IP, user agent.
- Embed all of the above in the rendered PDF metadata page for legal defensibility.
- Audit logged.

### 8.7 Report generation (the deliverable that matters)

This is what Brian sends to adjusters. **Quality and styling are non-negotiable.**

**Branding (per Brian's spec for Nassau County):**

- Header: dark blue (`#1e3a8a`) bar with horizontal white logo (logo file path stored in Org settings).
- Footer: company name + license + page number.
- Cover page: customer name, address, claim number, loss date, report type, generated date.

**Report types and contents:**

|Report               |Sections                                                                                                                                                                     |
|---------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|**Water Mitigation** |Cover, scope summary, room-by-room photos, moisture readings (charts + table), drying logs, equipment placement log, certifications/forms                                    |
|**Fire Loss**        |Cover, scope summary, room-by-room photos with salvageability ratings, contents-disposition summary (placeholder for v2), forms                                              |
|**Mold Remediation** |Cover, scope summary, photos, moisture/RH readings, containment description (free-form), forms                                                                               |
|**Photo Report**     |Cover, photo grid by room with captions                                                                                                                                      |
|**Moisture Log**     |Cover, all readings table, time-series chart per surface                                                                                                                     |
|**Equipment Log**    |Cover, equipment placement Gantt, daily count table                                                                                                                          |
|**Estimate Proposal**|Cover, scope description, line items with quantities and prices, **O&P at 20%**, **Nassau County sales tax at 8.625% on full total**, payment terms (50/50), signature blocks|

**Estimate Proposal specifics (per project memory):**

- Line items entered manually in v1 (no Xactimate price import yet).
- Subtotal → +O&P (20%) → +Sales tax (8.625% on subtotal+O&P) → Total.
- Payment terms section: "50% due at start, 50% due at completion."
- Signature blocks for customer and contractor.

**PDF generation pipeline:**

1. Server Action → BullMQ job queued.
1. Worker renders HTML template (Handlebars) with full data snapshot.
1. Puppeteer prints HTML to PDF (letter, color, embedded images).
1. PDF uploaded to MinIO/R2.
1. `Report` row created with `pdfStorageKey` and `dataSnapshot`.
1. UI polls until ready (typically 5-30 seconds).
1. Download / email options shown.

**Templates:** Store HTML templates in `/templates/reports/{type}.hbs`. Editable via admin UI in v2; hardcoded in v1.

### 8.8 Customer/adjuster sharing

- From a job, generate a shareable link for the adjuster.
- Configurable: include photos? include moisture data? include reports? expiration date.
- Recipient lands on a stripped-down public view (no nav, just the shared content).
- Shares are revocable.
- All accesses logged.

-----

## 9. Mobile / PWA Strategy

### Why PWA, not native

- Single codebase. One thing to maintain.
- iOS Safari supports enough of the Web App APIs in 2026 to make this work for our use case.
- App Store distribution unnecessary for an internal tool.
- Native upgrade path stays open if we ever need it (Capacitor wrap of the same Next.js app).

### PWA requirements

- Installable: manifest.json with icons (512x512, 192x192, maskable), short_name "FieldRestore".
- Service worker (Workbox via next-pwa) caches:
  - App shell (HTML, JS, CSS) — stale-while-revalidate
  - Static photos already viewed — cache-first, 30 days
  - API responses — network-first with timeout fallback to cache for read-only data
- Offline fallback page for when network and cache both miss.

### Offline capture (the key field-tech requirement)

The technician will be in basements with no signal. Photo capture and reading entry MUST work fully offline.

**Architecture:**

1. New photos/readings/notes go to **IndexedDB queue** first (Dexie.js).
1. UI shows them immediately as if uploaded.
1. Background sync worker monitors network state.
1. When online, drains queue serially: upload photo → POST metadata → mark synced.
1. Conflict resolution: server is source of truth, client retries with exponential backoff up to 24h. After 24h, surface a "stuck items" UI for manual review.
1. Sync status visible in app header: green dot (synced), yellow dot (queued), red dot (errors).

**What works offline:**

- View any data already loaded (jobs you've opened recently).
- Take photos and assign them to rooms.
- Enter moisture readings.
- Enter notes.
- Edit room info.
- Start a sketch (saves locally, syncs on reconnect).

**What requires online:**

- Initial login.
- Searching for jobs not previously loaded.
- Generating reports.
- Sending forms.
- Sketching: editing existing remote sketches with conflict resolution (just lock the sketch to the user actively editing).

### Camera capture details

- v1: `<input type="file" accept="image/*" capture="environment" multiple>`. Works on every modern phone, no permission gymnastics.
- HEIC handling: server detects, converts to JPEG via Sharp on receive.
- v2: switch to `getUserMedia` with custom UI for in-app capture, watermarking, "guided photo" prompts.

-----

## 10. File Storage

### Bucket layout (single bucket, organized by prefix)

```
{bucket}/
├── orgs/{orgId}/
│   ├── logos/{filename}
│   └── jobs/{jobId}/
│       ├── photos/{photoId}/
│       │   ├── original.jpg     (or .heic, .png)
│       │   ├── medium.webp
│       │   └── thumb.webp
│       ├── sketches/{sketchId}/
│       │   ├── export.png
│       │   └── export.pdf
│       ├── reports/{reportId}.pdf
│       └── forms/{submissionId}.pdf
└── tmp/                          (uploads in progress, lifecycle-rule deleted after 24h)
```

### Access pattern

- Server generates **presigned URLs** for both upload and download.
- Browser uploads directly to MinIO/R2 with presigned URL — never proxies through Next.js.
- Read URLs are short-lived (15 min) presigned, regenerated on demand.
- Public-share links go through a Next.js endpoint that checks the JobShare token before issuing a presigned URL.

### Backup strategy

- Restic-based daily snapshots of MinIO bucket → off-site S3-compatible storage (Backblaze B2 or another VPS).
- Retention: 30 daily, 12 monthly, 5 yearly.
- PostgreSQL: `pg_dump` daily → same off-site bucket.
- Monthly restore drill (automated): spin up scratch container, restore latest backup, verify row counts. Email report to Owner.

-----

## 11. Image Processing Pipeline

```
Upload         → MinIO /tmp/{uuid}.{ext}
                   ↓
                 BullMQ job: image-process
                   ↓
Sharp pipeline:
  1. Read original
  2. Detect HEIC, convert to JPEG
  3. Read EXIF (taken date, GPS, device)
  4. Generate thumb.webp (320px max edge, q=80)
  5. Generate medium.webp (1280px max edge, q=85)
  6. Move original to final key
  7. Update Photo row with metadata, mark uploaded
                   ↓
              Notify client via revalidation tag
```

Errors during processing:

- Mark Photo as `processingError` with reason.
- Retry up to 3 times with exponential backoff.
- After 3 failures, surface in admin UI for manual review.

-----

## 12. Sketch → Xactimate Export Workflow

Document this in the in-app help so techs/estimators know the flow.

1. In the field, draw the sketch in FieldRestore.
1. From the sketch view, tap **Export → Xactimate Underlay**.
1. App generates PNG (2x DPI, scale bar visible, room labels visible, dimensions visible).
1. Download PNG to estimator's machine.
1. In Xactimate desktop: open project → Estimate → Sketch → Options → Import → Import Underlay Image → select the PNG.
1. Use Xactimate's wall tool to trace over the underlay (5-10 minutes for a typical residential job).
1. The Xactimate sketch is now native — proceed with line items, macros, etc.

**Why this works:** Xactimate's underlay feature is designed exactly for this use case. The estimator's hands stay on the tool they already know. We don't fight Verisk's gated API.

-----

## 13. Deployment & Infrastructure

### Target environment

- Single VPS (Hetzner CX32 recommended: 4 vCPU, 8GB RAM, 80GB SSD, ~$8/mo) OR an office-local server.
- Ubuntu 24.04 LTS.
- Docker Engine + Docker Compose v2.
- Domain pointed at the VPS, A record only (Caddy handles HTTPS).

### docker-compose.yml services

```yaml
services:
  caddy:        # reverse proxy + auto-HTTPS
  app:          # Next.js app (port 3000 internal)
  worker:       # Same image, different command — runs BullMQ workers
  postgres:     # PostgreSQL 16
  redis:        # Redis 7 for BullMQ
  minio:        # S3-compatible storage (or use Cloudflare R2 instead and skip this)
  uptimekuma:   # optional: monitoring on subdomain
```

### Environment variables (provide a `.env.example`)

```
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
S3_ENDPOINT=...
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_BUCKET=fieldrestore
NEXTAUTH_SECRET=...
NEXTAUTH_URL=https://fieldrestore.example.com
SMTP_HOST=...
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=
INITIAL_OWNER_EMAIL=brian@example.com
INITIAL_OWNER_PASSWORD=  # one-time, deleted after first login
ORG_NAME="1-800 Water Damage of Nassau County"
ORG_PRIMARY_COLOR=#1e3a8a
```

### First-boot flow

1. Bring up Compose stack.
1. App container runs `prisma migrate deploy`.
1. Seed script runs ONLY if no organization exists: creates org from ENV vars, creates owner user from ENV vars, creates default form templates.
1. Caddy obtains TLS cert.
1. Owner navigates to URL, logs in, immediately changes password and enables 2FA.

### CI/CD

- GitHub Actions: on push to `main`, run typecheck + tests + Prisma validate, build Docker image, push to GHCR.
- Deploy via `docker compose pull && docker compose up -d` over SSH (single-server deploy script).
- Migrations run automatically on container start, idempotent.

-----

## 14. Build Phases (Claude Code Execution Plan)

Each phase is sized for ~one Claude Code session. Run them in order. Do not skip ahead. After each phase, verify the **Definition of Done** before continuing.

-----

### Phase 0 — Project bootstrap

**Goal:** Empty but runnable project with the chosen stack wired up.

**Tasks:**

1. `npx create-next-app@latest fieldrestore --ts --tailwind --app --eslint --src-dir --import-alias "@/*"` (use Next.js 15+).
1. Install: `prisma @prisma/client zod @auth/core next-auth react-hook-form @hookform/resolvers @tanstack/react-query bullmq ioredis sharp puppeteer pino dexie konva react-konva recharts handlebars`.
1. Install dev deps: `tsx vitest @vitest/ui @testing-library/react @testing-library/user-event prettier @types/node`.
1. Initialize shadcn/ui: `npx shadcn@latest init`. Add components as needed: `button input label card dialog form select textarea table tabs sheet toast dropdown-menu`.
1. Create `docker-compose.dev.yml` with postgres + redis + minio for local dev.
1. Set up `.env.example` and `.env.local`.
1. Write the Prisma schema from Section 6 verbatim. Run `prisma migrate dev --name init`.
1. Write `prisma/seed.ts` per spec. Run `prisma db seed`.
1. Stub a single page at `/` that renders "FieldRestore is alive" if the DB connection works.

**Definition of done:**

- `pnpm dev` brings up Next.js, connects to local Docker Postgres, displays the alive page.
- `pnpm prisma studio` shows seed data.
- `pnpm typecheck` and `pnpm lint` pass with zero errors.
- Repo committed to git with sensible `.gitignore`.

-----

### Phase 1 — Auth & user management

**Goal:** Real users can log in. Roles enforce on a stubbed-out admin page.

**Tasks:**

1. Configure Auth.js v5 with Credentials provider. bcrypt password hashing with cost 12.
1. Login page at `/login`. Logout action.
1. Forgot-password flow with email magic link (use a dev console transporter for now — wire up real SMTP later).
1. Middleware that redirects unauthenticated users to `/login` for any route under `/app/*`.
1. Build the `can(user, action, resource)` helper per Section 7.
1. Build `withAudit()` Server Action wrapper.
1. Build `/app/admin/users` page (Owner+OfficeAdmin only) with list + invite + role-edit + deactivate.
1. Implement TOTP 2FA setup and verification flow for any user.
1. Magic-link login flow for subcontractors (token-based, no password).

**Definition of done:**

- Seed user can log in. Wrong password fails clearly.
- Can invite a new user via email; new user sets password and logs in.
- Owner can change another user's role; Tech cannot see the admin page.
- TOTP can be enabled and required-on-next-login.
- All login/logout/role-change events appear in `AuditLog`.

-----

### Phase 2 — Job & Customer CRUD

**Goal:** Full job lifecycle works on desktop. Mobile-friendly but no offline yet.

**Tasks:**

1. `/app/customers` — list, create, edit, search.
1. `/app/jobs` — list with filters, search, sorting.
1. `/app/jobs/new` — create flow per Section 8.1.
1. `/app/jobs/[id]` — detail page with tabs (Overview, Rooms, Photos, Moisture, Drying, Equipment, Sketches, Forms, Reports, Activity). Most tabs are stubs at this point.
1. Job-number generator: atomic per-org sequence in a `JobNumberCounter` table or via SELECT…FOR UPDATE.
1. Job assignment UI: add/remove users on a job.
1. Status transitions with valid-state-machine enforcement (DRAFT → ACTIVE → DRYING → COMPLETE → CLOSED, plus ON_HOLD and CANCELLED side-states).
1. Rooms tab fully functional: add/edit/delete/reorder rooms, capture cat/class/materials.

**Definition of done:**

- Can create a customer, then create a job for them, then add three rooms.
- Job number auto-generates correctly with no collisions under concurrent load (write a test).
- Status transitions enforced (write a test).
- Audit log captures all mutations.

-----

### Phase 3 — Photos (online only)

**Goal:** Capture, upload, organize, view. Offline comes in Phase 8.

**Tasks:**

1. MinIO client wrapper with presigned URL generation.
1. Photo upload Server Action + direct-to-S3 upload from browser.
1. BullMQ image-processing job (Sharp pipeline per Section 11).
1. Photos tab on job page: grid view, lightbox, filter by room, multi-select, bulk actions.
1. Per-photo: caption, tags, salvageability, room assignment.
1. Auto-classify button for fire jobs (rules per Section 8.2).
1. Bulk upload (drag-drop on desktop, multi-pick on mobile).
1. Worker process Dockerfile + Compose entry.

**Definition of done:**

- Upload 50 photos in one batch on mobile and desktop. All process correctly.
- Thumbnails generate in under 5 seconds total.
- EXIF GPS extraction works (test with a real geotagged photo).
- HEIC photos convert correctly.
- Originals are preserved unmodified.
- Lightbox is fast: <200ms to open from a grid tap.

-----

### Phase 4 — Moisture readings & drying logs

**Tasks:**

1. Reading entry form (mobile-optimized) per Section 8.4.
1. Bulk reading entry: "I'm taking 8 readings on the kitchen drywall" — reuse surface, just enter values rapidly.
1. Reading list/table with filters.
1. Per-surface time-series chart (Recharts).
1. Dry-goal tracking and "stuck" warnings.
1. Drying log: one-row-per-day entry form, GPP auto-calculation from temp+RH.
1. Equipment-recommendation banner (basic, based on affected sqft).

**Definition of done:**

- Tech can enter a reading in <10 seconds on mobile.
- Chart renders correctly with multiple surfaces.
- Stuck warning appears at day 6 of no progress.
- GPP calc matches a hand-computed reference value within 0.5 GPP.

-----

### Phase 5 — Equipment

**Tasks:**

1. Equipment master list at `/app/equipment` (Owner+OfficeAdmin).
1. CRUD with bulk CSV import.
1. Per-job equipment placement (assign / remove with timestamps).
1. Daily count cron (BullMQ repeat job at midnight org-local time).
1. Per-job equipment timeline view (Gantt-style, simple SVG is fine).

**Definition of done:**

- Bulk import 30 equipment items from CSV.
- Place 5 air movers on a job, remove 2 the next day. Daily count is correct for both days.
- Equipment status correctly transitions AVAILABLE → DEPLOYED → AVAILABLE.

-----

### Phase 6 — Sketching tool

**Goal:** Draw a usable floor plan on desktop and tablet.

**Tasks:**

1. `/app/jobs/[id]/sketches/[sketchId]` — Konva-based editor.
1. Tools: Select, Wall, Door, Window, Opening, Label, Dimension, Eraser.
1. Snap-to-grid, snap-to-endpoint.
1. Multi-floor tabs.
1. Save scene JSON to `Sketch.sceneData` debounced every 5 seconds.
1. Server-side renderer using Puppeteer + a dedicated `/render/sketch/:id` page that draws the same scene.
1. Export endpoints: PNG (1x, 2x), PDF.
1. Phone view shows read-only thumbnails (drawing on phone is too painful — that's fine).

**Definition of done:**

- Can draw a 4-room single-story home in <10 minutes on a tablet.
- Walls snap correctly. Doors and windows snap to walls.
- Exported PNG is sharp at 2x DPI and shows all measurements.
- PDF opens cleanly in Xactimate as an underlay.
- Sketch save is reliable (no data loss on browser refresh mid-edit).

-----

### Phase 7 — Forms & e-signatures

**Tasks:**

1. Two default templates per spec (AOB, COC) implemented as Handlebars HTML templates.
1. `/app/admin/forms` — Owner+OfficeAdmin can manage templates (in v1, edit raw schema + HTML; v2: visual builder).
1. Form submission flow: pre-fill from job → send via email magic link → recipient signs → PDF generated and attached to job.
1. Signature pad component (reuse existing library like `react-signature-canvas`).
1. Audit metadata embedded in PDF (last page: "Signed by X, IP Y, at Z time").
1. Resend / void / mark-completed actions.

**Definition of done:**

- Send AOB to a test email, sign on a real phone, see signed PDF on the job within 30 seconds.
- COC works end-to-end.
- Audit page on PDF is correct.

-----

### Phase 8 — Offline / PWA

**Goal:** Field-tech experience: no signal, no problem.

**Tasks:**

1. Add manifest.json, icons, service worker via next-pwa.
1. IndexedDB schema (Dexie) for: queued photos (with blob), queued readings, queued notes, cached job summaries, cached room data.
1. Sync engine: serial drain of queue, retry with exponential backoff, surface stuck items.
1. UI sync indicator in header.
1. Aggressive caching of recently-viewed jobs (last 20).
1. Test plan: airplane mode → take 10 photos, enter 5 readings, write 3 notes, exit airplane mode, observe successful sync.
1. "Stuck items" admin page for resolving unsyncable items.

**Definition of done:**

- App is installable as PWA on iOS Safari and Android Chrome.
- Full airplane-mode test passes: capture 10 photos, 5 readings, sync cleanly when network returns.
- Sync queue survives a browser restart.
- No data is ever silently dropped.

-----

### Phase 9 — Reports

**Goal:** Carrier-ready PDFs for every report type in Section 8.7.

**Tasks:**

1. Report-generation Server Action → BullMQ job.
1. HTML templates per report type (Handlebars). Match Brian's branding spec exactly: dark blue header, white horizontal logo, footer with company name + license.
1. Puppeteer-based PDF generation.
1. Data snapshot saved on `Report.dataSnapshot` for legal defensibility.
1. Reports tab shows list with download / email / regenerate.
1. Estimate Proposal: line-item entry UI with O&P 20% and Nassau County sales tax 8.625% baked in (configurable per org for portability).
1. Email-with-link: "Your report is ready" — link goes to authenticated app or to a public-share endpoint.

**Definition of done:**

- Generate a Water Mitigation report on a job with 30 photos, 50 readings, 7 days of drying logs. PDF is under 15MB and visually polished.
- Estimate Proposal math: subtotal $10,000 → +20% O&P = $12,000 → +8.625% tax on $12,000 = $1,035 → total $13,035. Verify exact math.
- Generated PDFs open cleanly in Adobe and Apple Preview.

-----

### Phase 10 — Sharing, polish, deployment

**Tasks:**

1. JobShare creation UI: pick what to share, set expiration, email link.
1. Public share view (no nav, branded landing page).
1. Revoke / extend / view-history of shares.
1. Notification preferences per user (email me when a job I'm on changes status, etc.).
1. Search across all jobs/customers/photos (Postgres full-text search is plenty for v1).
1. Import-from-Encircle path: CSV importer for customer + job basic info to ease migration.
1. Production `docker-compose.yml` with Caddy, app, worker, postgres, redis, minio.
1. Backup automation (Restic).
1. Uptime monitoring.
1. README with deployment runbook.

**Definition of done:**

- Single-command deploy on a fresh Hetzner VPS.
- Backup runs successfully, restore drill verified.
- Public share link viewable without login, expires correctly, revoked correctly.
- Encircle CSV import populates the system with at least 100 historical jobs.

-----

### Phase 11 — Hardening

**Tasks:**

1. Rate limiting on auth endpoints (Upstash-compatible or simple Redis-based).
1. Brute-force protection on login.
1. CSP headers, security headers via Caddy.
1. SAST sweep (`pnpm audit`, fix all high+).
1. Load test with k6: simulate 5 concurrent users uploading 20 photos each. Response times stay reasonable.
1. Penetration test checklist: IDOR, XSS, SSRF in PDF generator, file-upload type validation.
1. Disaster-recovery drill: kill the VPS, restore on a new one from backups, confirm <2h RTO.

**Definition of done:**

- All security headers A+ on securityheaders.com.
- DR drill passes.
- Load test: p95 <2s for all read endpoints, <5s for photo uploads.

-----

### Phase 12 — User testing & rollout

Not a coding phase. Brian + 1-2 techs use the app for real on 5 small water jobs in parallel with Encircle. Compare output. Fix friction. Then commit to migration.

-----

## 15. Testing Strategy

### Unit

- Vitest for utility functions, Zod schemas, business logic (job-number generator, GPP calculator, salvageability auto-classifier, sales-tax math).
- Goal: 100% coverage on `/lib/business/*`.

### Integration

- Vitest with a real test Postgres in Docker.
- Test every Server Action with a real DB session.
- Test BullMQ jobs (image processing, PDF generation) end-to-end.

### E2E

- Playwright on the critical paths:
1. New user logs in, creates customer, creates job, uploads photos, generates report.
1. Tech goes offline, captures data, syncs.
1. Adjuster opens public share link, views report.
1. Owner enables 2FA, logs in with TOTP.
- Run on every PR to `main`.

### Manual / acceptance

- Dedicated checklist per phase DoD.
- Brian himself does the final acceptance run on a real job before cutover.

-----

## 16. Security Requirements

- TLS only (HSTS enforced).
- CSP with strict defaults; allow only self + inline-styles from Tailwind.
- Passwords: bcrypt cost 12 minimum.
- Sessions: HttpOnly, Secure, SameSite=Lax cookies.
- Magic links: single-use, 1h expiry for password reset, 7d for sub-contractor invites.
- File uploads: extension + magic-byte check, max 50MB per photo, max 200MB per video.
- PDF generator: never load remote URLs in Puppeteer (no SSRF), only local filesystem and inline data URIs for images.
- Rate limit: login (5/min/IP), magic link send (3/hour/email), report generation (10/hour/user).
- Audit log retention: 7 years (insurance industry standard).
- Backup encryption: Restic native repository encryption.
- 2FA mandatory for OWNER and OFFICE_ADMIN after Phase 11.

-----

## 17. Future Roadmap (NOT in v1)

These ideas are documented so the architecture supports them, but **do not build them yet**:

- **Contents inventory & packout** — full module with item-level photos, room-of-origin, RCV pricing via a hosted lookup, schedule-of-loss reports.
- **Smartphone room-scanning** — RoomPlan iOS shim or CubiCasa integration for auto-generated floor plans.
- **AI item descriptions** — same as Encircle's: snap a photo of a contents item, model returns standardized description.
- **AI scope of mitigation** — feed photos + readings + sketch into a model, get a draft mitigation scope.
- **Direct Xactimate integration** — would require Verisk data-provider partnership; revisit if scaling beyond a single franchise.
- **Multi-tenant SaaS** — already structured for it (Organization is the top-level tenant) but skip the billing/onboarding flow until there's a customer.
- **Native mobile shells** — wrap with Capacitor if PWA ever hits a real wall.
- **Voice notes** — record audio attached to photos/jobs.
- **Twilio SMS notifications** — text the customer when techs arrive, etc.
- **Payment collection** — only if Brian's existing AR system isn't sufficient.

-----

## 18. Glossary

|Term          |Meaning                                                   |
|--------------|----------------------------------------------------------|
|**AOB**       |Authorization to Perform Services / Assignment of Benefits|
|**CFM**       |Cubic feet per minute — air mover capacity                |
|**COC**       |Certificate of Completion                                 |
|**ESX**       |Xactimate's proprietary project file format               |
|**GPP**       |Grains per pound — absolute humidity measure              |
|**IICRC S500**|Industry standard for water damage restoration            |
|**LGR**       |Low-grain refrigerant (a class of dehumidifier)           |
|**O&P**       |Overhead & Profit (typically 20% in restoration)          |
|**PPD**       |Pints per day — dehumidifier capacity                     |
|**RCV**       |Replacement Cost Value                                    |
|**WME**       |Wood moisture equivalent                                  |
|**XactNet**   |Verisk's email-based data exchange address format         |

-----

## 19. Open Questions for Brian (resolve before Phase 9)

1. Estimate Proposal: should we support more than one tax region (e.g., if 1-800 Water Damage expands to NJ)? — assume YES, make tax rate per-org-configurable.
1. Equipment billing rates — do we just track placement, or also per-day billing rates per equipment type for invoice generation? — assume placement-only in v1, billing math in v2.
1. Customer-facing portal — does the customer ever log in, or do they only ever receive shared links? — assume share-link-only in v1.
1. Integration with QuickBooks or other AR — assume out-of-scope, but we'll add a CSV export of completed jobs for manual import.
1. Multi-language Spanish UI for techs — assume out-of-scope for v1, but keep all strings in i18n-able structure (easy to add later).

-----

## 20. Done. Ship it.

Build phase by phase. Don't skip ahead. Lean on the Definition of Done.

If a phase reveals an architectural flaw in this PRD, **stop and update the PRD first**, then continue. The PRD is the single source of truth.

When phase 12 passes, cancel Encircle.
