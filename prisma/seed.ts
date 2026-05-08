/**
 * Idempotent seed script — see FIELDRESTORE_PRD.md §6 + §13.
 *
 * Creates (only if they don't already exist):
 *   - one Organization, slug from ORG_SLUG env (default "1800wd-nassau")
 *   - one OWNER User, email from INITIAL_OWNER_EMAIL env
 *   - three sample Equipment items
 *   - two default FormTemplate records (AOB, COC)
 *
 * Re-running the seed is safe: existing rows are left untouched.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function envOrDefault(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.length > 0 ? v : fallback;
}

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) {
    throw new Error(
      `Missing required env var ${key}. Set it in .env.local before seeding.`,
    );
  }
  return v;
}

async function main() {
  const orgName = envOrDefault(
    "ORG_NAME",
    "1-800 Water Damage of Nassau County",
  );
  const orgSlug = envOrDefault("ORG_SLUG", "1800wd-nassau");
  const orgPrimaryColor = envOrDefault("ORG_PRIMARY_COLOR", "#1e3a8a");
  const orgReportFooter = envOrDefault(
    "ORG_REPORT_FOOTER",
    "1-800 Water Damage of Nassau County",
  );
  const orgJobNumberPrefix = envOrDefault("ORG_JOB_NUMBER_PREFIX", "JOB");

  const ownerEmail = envOrThrow("INITIAL_OWNER_EMAIL");
  const ownerPassword = envOrThrow("INITIAL_OWNER_PASSWORD");
  const ownerName = envOrDefault("INITIAL_OWNER_NAME", "Owner");

  // ---- Organization ----
  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    create: {
      name: orgName,
      slug: orgSlug,
      primaryColor: orgPrimaryColor,
      reportFooter: orgReportFooter,
      jobNumberPrefix: orgJobNumberPrefix,
    },
    update: { jobNumberPrefix: orgJobNumberPrefix },
  });
  console.log(`[seed] Organization "${org.name}" (${org.slug})`);

  // ---- Owner user ----
  const passwordHash = await bcrypt.hash(ownerPassword, 12);
  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    create: {
      email: ownerEmail,
      passwordHash,
      name: ownerName,
      role: "OWNER",
      active: true,
      organizationId: org.id,
    },
    update: {},
  });
  console.log(`[seed] Owner user ${owner.email} (role=${owner.role})`);

  // ---- Sample equipment ----
  const sampleEquipment: Array<Prisma.EquipmentCreateInput> = [
    {
      assetTag: "AM-001",
      type: "AIR_MOVER",
      manufacturer: "Phoenix",
      model: "Axial AirMax",
      cfm: 2900,
      amperage: 1.5,
      organization: { connect: { id: org.id } },
    },
    {
      assetTag: "DH-001",
      type: "DEHUMIDIFIER_LGR",
      manufacturer: "Dri-Eaz",
      model: "LGR 7000XLi",
      ppd: 235,
      amperage: 7.0,
      organization: { connect: { id: org.id } },
    },
    {
      assetTag: "AS-001",
      type: "AIR_SCRUBBER_HEPA",
      manufacturer: "Dri-Eaz",
      model: "DefendAir HEPA 500",
      cfm: 500,
      amperage: 2.5,
      organization: { connect: { id: org.id } },
    },
  ];

  for (const data of sampleEquipment) {
    await prisma.equipment.upsert({
      where: { assetTag: data.assetTag },
      create: data,
      update: {},
    });
  }
  console.log(`[seed] ${sampleEquipment.length} sample equipment items`);

  // ---- Default form templates ----
  const aobTemplate = {
    name: "Authorization to Perform Services",
    schema: {
      fields: [
        { id: "customerName", label: "Customer name", type: "text", required: true },
        { id: "lossAddress", label: "Loss address", type: "text", required: true },
        { id: "lossDate", label: "Date of loss", type: "date", required: true },
        { id: "scopeSummary", label: "Scope summary", type: "textarea", required: false },
        { id: "customerSignature", label: "Customer signature", type: "signature", required: true },
        { id: "techSignature", label: "Technician signature", type: "signature", required: true },
      ],
    },
    bodyTemplate: `<h1>Authorization to Perform Services</h1>
<p>I, <strong>{{customer.firstName}} {{customer.lastName}}</strong>, the undersigned, authorize {{org.name}} to perform restoration services at <strong>{{customer.addressLine1}}, {{customer.city}}, {{customer.state}} {{customer.postalCode}}</strong> in connection with the loss occurring on or about <strong>{{job.lossDate}}</strong>.</p>
<p>I understand that I remain responsible for any deductible and any charges not covered by my insurance carrier.</p>
<p>I authorize my insurance carrier to release information regarding this claim to {{org.name}} and to issue payment directly to {{org.name}} for services rendered.</p>`,
  };

  const cocTemplate = {
    name: "Certificate of Completion",
    schema: {
      fields: [
        { id: "customerName", label: "Customer name", type: "text", required: true },
        { id: "completionDate", label: "Completion date", type: "date", required: true },
        { id: "satisfactionRating", label: "Satisfaction (1-5)", type: "text", required: false },
        { id: "comments", label: "Comments", type: "textarea", required: false },
        { id: "customerSignature", label: "Customer signature", type: "signature", required: true },
      ],
    },
    bodyTemplate: `<h1>Certificate of Completion</h1>
<p>I, <strong>{{customer.firstName}} {{customer.lastName}}</strong>, acknowledge that {{org.name}} has completed the agreed-upon restoration services at <strong>{{customer.addressLine1}}, {{customer.city}}, {{customer.state}} {{customer.postalCode}}</strong> for job <strong>{{job.jobNumber}}</strong>.</p>
<p>The work has been performed to my satisfaction as of <strong>{{completionDate}}</strong>.</p>`,
  };

  for (const tpl of [aobTemplate, cocTemplate]) {
    const existing = await prisma.formTemplate.findFirst({
      where: { organizationId: org.id, name: tpl.name },
    });
    if (existing) continue;
    await prisma.formTemplate.create({
      data: {
        organizationId: org.id,
        name: tpl.name,
        schema: tpl.schema,
        bodyTemplate: tpl.bodyTemplate,
        active: true,
      },
    });
  }
  console.log(`[seed] 2 default form templates (AOB, COC)`);

  console.log("[seed] done.");
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
