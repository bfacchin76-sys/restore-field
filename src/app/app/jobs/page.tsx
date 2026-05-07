import Link from "next/link";
import { redirect } from "next/navigation";
import { JobStatus, LossType, type Prisma } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const STATUS_FILTERS: { label: string; values: JobStatus[] }[] = [
  { label: "All", values: Object.values(JobStatus) },
  { label: "Active", values: [JobStatus.ACTIVE] },
  { label: "Drying", values: [JobStatus.DRYING] },
  { label: "Complete", values: [JobStatus.COMPLETE] },
  { label: "Closed", values: [JobStatus.CLOSED] },
];

export default async function JobsListPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    loss?: string;
    mine?: string;
  }>;
}) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");

  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const statusFilter = sp.status as keyof typeof StatusByLabel | undefined;
  const lossFilter = (sp.loss as LossType | undefined) ?? undefined;
  const onlyMine = sp.mine === "1";

  const StatusByLabel: Record<string, JobStatus[]> = {
    active: [JobStatus.ACTIVE],
    drying: [JobStatus.DRYING],
    complete: [JobStatus.COMPLETE],
    closed: [JobStatus.CLOSED],
  };

  const where: Prisma.JobWhereInput = {
    organizationId: actor.organizationId,
    ...(statusFilter && StatusByLabel[statusFilter]
      ? { status: { in: StatusByLabel[statusFilter] } }
      : {}),
    ...(lossFilter ? { lossType: lossFilter } : {}),
    ...(onlyMine
      ? {
          OR: [
            { createdById: actor.id },
            { assignments: { some: { userId: actor.id } } },
          ],
        }
      : {}),
    ...(query
      ? {
          AND: [
            {
              OR: [
                { jobNumber: { contains: query, mode: "insensitive" } },
                {
                  customer: {
                    OR: [
                      { firstName: { contains: query, mode: "insensitive" } },
                      { lastName: { contains: query, mode: "insensitive" } },
                      { addressLine1: { contains: query, mode: "insensitive" } },
                      { city: { contains: query, mode: "insensitive" } },
                      { claimNumber: { contains: query, mode: "insensitive" } },
                    ],
                  },
                },
              ],
            },
          ],
        }
      : {}),
  };

  const jobs = await prisma.job.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      customer: {
        select: { firstName: true, lastName: true, addressLine1: true, city: true },
      },
      _count: { select: { photos: true, rooms: true } },
      assignments: {
        where: { role: "lead" },
        include: { user: { select: { name: true } } },
        take: 1,
      },
    },
  });

  const linkFor = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    if (query) u.set("q", query);
    if (statusFilter) u.set("status", statusFilter);
    if (lossFilter) u.set("loss", lossFilter);
    if (onlyMine) u.set("mine", "1");
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) u.delete(k);
      else u.set(k, v);
    }
    const qs = u.toString();
    return qs ? `/app/jobs?${qs}` : "/app/jobs";
  };

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-sm text-muted-foreground">
            {jobs.length} shown · most recently updated first
          </p>
        </div>
        <Link
          href="/app/jobs/new"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          New job
        </Link>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <form action="/app/jobs" method="get" className="flex flex-wrap gap-2">
            <Input
              name="q"
              defaultValue={query}
              placeholder="Search by job number, customer, address, claim # …"
              className="min-w-[260px] flex-1"
            />
            {statusFilter ? (
              <input type="hidden" name="status" value={statusFilter} />
            ) : null}
            {lossFilter ? <input type="hidden" name="loss" value={lossFilter} /> : null}
            {onlyMine ? <input type="hidden" name="mine" value="1" /> : null}
            <Button type="submit" variant="outline">
              Search
            </Button>
            {query ? (
              <Link
                href={linkFor({ q: undefined })}
                className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-3 text-sm hover:bg-accent"
              >
                Clear
              </Link>
            ) : null}
          </form>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium uppercase text-muted-foreground">Status:</span>
            {STATUS_FILTERS.map((f) => {
              const key = f.label.toLowerCase();
              const active =
                (statusFilter ?? "all") === key ||
                (!statusFilter && f.label === "All");
              return (
                <Link
                  key={f.label}
                  href={linkFor({ status: key === "all" ? undefined : key })}
                  className={`rounded-full border px-3 py-1 ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {f.label}
                </Link>
              );
            })}

            <span className="ml-4 font-medium uppercase text-muted-foreground">Loss:</span>
            <Link
              href={linkFor({ loss: undefined })}
              className={`rounded-full border px-3 py-1 ${
                !lossFilter
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              All
            </Link>
            {Object.values(LossType).map((lt) => (
              <Link
                key={lt}
                href={linkFor({ loss: lt })}
                className={`rounded-full border px-3 py-1 ${
                  lossFilter === lt
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                {lt.toLowerCase()}
              </Link>
            ))}

            <Link
              href={linkFor({ mine: onlyMine ? undefined : "1" })}
              className={`ml-auto rounded-full border px-3 py-1 ${
                onlyMine
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {onlyMine ? "My jobs only" : "All team jobs"}
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Jobs</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {jobs.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">
              No jobs match.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-6 py-3">Job #</th>
                  <th className="px-6 py-3">Customer</th>
                  <th className="px-6 py-3">Address</th>
                  <th className="px-6 py-3">Loss</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Lead</th>
                  <th className="px-6 py-3">Photos</th>
                  <th className="px-6 py-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-b last:border-b-0">
                    <td className="px-6 py-3 font-mono text-xs">
                      <Link href={`/app/jobs/${j.id}`} className="hover:underline">
                        {j.jobNumber}
                      </Link>
                    </td>
                    <td className="px-6 py-3">
                      {j.customer.firstName} {j.customer.lastName}
                    </td>
                    <td className="px-6 py-3 text-xs text-muted-foreground">
                      {j.customer.addressLine1}, {j.customer.city}
                    </td>
                    <td className="px-6 py-3 text-xs uppercase">
                      {j.lossType.toLowerCase()}
                    </td>
                    <td className="px-6 py-3 text-xs uppercase">
                      <StatusBadge status={j.status} />
                    </td>
                    <td className="px-6 py-3 text-xs text-muted-foreground">
                      {j.assignments[0]?.user.name ?? "—"}
                    </td>
                    <td className="px-6 py-3 tabular-nums">{j._count.photos}</td>
                    <td className="px-6 py-3 text-xs text-muted-foreground">
                      {j.updatedAt.toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  const palette: Record<JobStatus, string> = {
    DRAFT: "bg-muted text-muted-foreground",
    ACTIVE: "bg-blue-100 text-blue-800",
    DRYING: "bg-amber-100 text-amber-800",
    COMPLETE: "bg-emerald-100 text-emerald-800",
    ON_HOLD: "bg-orange-100 text-orange-800",
    CLOSED: "bg-slate-200 text-slate-700",
    CANCELLED: "bg-rose-100 text-rose-800",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${palette[status]}`}>
      {status.replace("_", " ").toLowerCase()}
    </span>
  );
}
