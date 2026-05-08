import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";

const TABS = [
  { href: "", label: "Overview" },
  { href: "/rooms", label: "Rooms" },
  { href: "/photos", label: "Photos" },
  { href: "/moisture", label: "Moisture" },
  { href: "/drying", label: "Drying" },
  { href: "/equipment", label: "Equipment" },
  { href: "/sketches", label: "Sketches" },
  { href: "/forms", label: "Forms" },
  { href: "/notes", label: "Notes" },
  { href: "/reports", label: "Reports" },
  { href: "/share", label: "Share" },
  { href: "/activity", label: "Activity" },
] as const;

export const dynamic = "force-dynamic";

export default async function JobLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");

  const { id } = await params;
  const job = await prisma.job.findUnique({
    where: { id },
    select: {
      id: true,
      jobNumber: true,
      status: true,
      lossType: true,
      lossDate: true,
      organizationId: true,
      createdById: true,
      assignments: { select: { userId: true } },
      customer: {
        select: {
          firstName: true,
          lastName: true,
          addressLine1: true,
          city: true,
          state: true,
          postalCode: true,
        },
      },
    },
  });
  if (!job) notFound();

  const canView = can(actor, "job.view", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });
  if (!canView) redirect("/app/jobs");

  return (
    <>
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/app/jobs" className="hover:underline">
            ← All jobs
          </Link>
        </p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              {job.jobNumber}
            </h1>
            <p className="text-sm text-muted-foreground">
              {job.customer.firstName} {job.customer.lastName} ·{" "}
              {job.customer.addressLine1}, {job.customer.city},{" "}
              {job.customer.state} {job.customer.postalCode}
            </p>
            <p className="text-xs uppercase text-muted-foreground">
              {job.lossType.toLowerCase()} · {job.status.replace("_", " ").toLowerCase()}
              {job.lossDate
                ? ` · loss ${job.lossDate.toLocaleDateString()}`
                : ""}
            </p>
          </div>
        </div>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-border text-sm">
        {TABS.map((t) => (
          <Link
            key={t.label}
            href={`/app/jobs/${job.id}${t.href}`}
            className="-mb-px border-b-2 border-transparent px-3 py-2 hover:border-primary hover:text-primary"
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-2">{children}</div>
    </>
  );
}
