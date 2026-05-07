import { redirect } from "next/navigation";
import { EquipmentStatus, EquipmentType } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateEquipmentForm } from "./create-form";
import { BulkImportForm } from "./bulk-import-form";
import { EquipmentRow } from "./equipment-row";
import { equipmentCsvHeader } from "@/lib/business/equipment";

export const dynamic = "force-dynamic";

export default async function EquipmentMasterPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; q?: string }>;
}) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");
  if (!can(actor, "equipment.manage", { id: actor.organizationId })) {
    redirect("/app");
  }

  const sp = await searchParams;
  const statusFilter = sp.status as EquipmentStatus | undefined;
  const typeFilter = sp.type as EquipmentType | undefined;
  const query = (sp.q ?? "").trim();

  const where = {
    organizationId: actor.organizationId,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(query
      ? {
          OR: [
            { assetTag: { contains: query, mode: "insensitive" as const } },
            { manufacturer: { contains: query, mode: "insensitive" as const } },
            { model: { contains: query, mode: "insensitive" as const } },
            { serialNumber: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const equipment = await prisma.equipment.findMany({
    where,
    orderBy: [{ status: "asc" }, { type: "asc" }, { assetTag: "asc" }],
    take: 1000,
    include: {
      placements: {
        where: { removedAt: null },
        include: {
          job: { select: { id: true, jobNumber: true } },
        },
      },
    },
  });

  const counts = await prisma.equipment.groupBy({
    by: ["status"],
    where: { organizationId: actor.organizationId },
    _count: true,
  });
  const statusCount = (s: EquipmentStatus) =>
    counts.find((c) => c.status === s)?._count ?? 0;

  const linkFor = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    if (statusFilter) u.set("status", statusFilter);
    if (typeFilter) u.set("type", typeFilter);
    if (query) u.set("q", query);
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) u.delete(k);
      else u.set(k, v);
    }
    const qs = u.toString();
    return qs ? `/app/equipment?${qs}` : "/app/equipment";
  };

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Equipment</h1>
        <p className="text-sm text-muted-foreground">
          Master list of every unit owned. Place units on jobs from the job&apos;s
          Equipment tab.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Available" value={statusCount("AVAILABLE")} />
        <StatTile label="Deployed" value={statusCount("DEPLOYED")} />
        <StatTile label="Maintenance" value={statusCount("MAINTENANCE")} />
        <StatTile label="Retired" value={statusCount("RETIRED")} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add equipment</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateEquipmentForm
            types={Object.values(EquipmentType)}
            statuses={Object.values(EquipmentStatus)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Bulk CSV import</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Paste a CSV with this header (extra columns ignored):
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-2 text-[11px]">
            {equipmentCsvHeader.join(",")}
          </pre>
          <BulkImportForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All equipment ({equipment.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-0 sm:p-0">
          <div className="flex flex-wrap items-center gap-2 px-6 pt-4 text-xs">
            <span className="font-medium uppercase text-muted-foreground">Status:</span>
            <FilterChip href={linkFor({ status: undefined })} active={!statusFilter}>
              all
            </FilterChip>
            {Object.values(EquipmentStatus).map((s) => (
              <FilterChip
                key={s}
                href={linkFor({ status: s })}
                active={statusFilter === s}
              >
                {s.toLowerCase()}
              </FilterChip>
            ))}

            <span className="ml-2 font-medium uppercase text-muted-foreground">Type:</span>
            <FilterChip href={linkFor({ type: undefined })} active={!typeFilter}>
              all
            </FilterChip>
            {Object.values(EquipmentType).map((t) => (
              <FilterChip
                key={t}
                href={linkFor({ type: t })}
                active={typeFilter === t}
              >
                {t.replace(/_/g, " ").toLowerCase()}
              </FilterChip>
            ))}
          </div>

          <div className="overflow-x-auto">
            {equipment.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                No equipment matches the current filters.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3">Asset tag</th>
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3">Manufacturer / Model</th>
                    <th className="px-6 py-3">Specs</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Current job</th>
                    <th className="px-6 py-3 text-right" />
                  </tr>
                </thead>
                <tbody>
                  {equipment.map((eq) => (
                    <EquipmentRow
                      key={eq.id}
                      equipment={{
                        id: eq.id,
                        assetTag: eq.assetTag,
                        type: eq.type,
                        manufacturer: eq.manufacturer,
                        model: eq.model,
                        serialNumber: eq.serialNumber,
                        amperage: eq.amperage,
                        cfm: eq.cfm,
                        ppd: eq.ppd,
                        status: eq.status,
                        notes: eq.notes,
                      }}
                      currentJob={eq.placements[0]?.job ?? null}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold tabular-nums">
        {value}
      </CardContent>
    </Card>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={`rounded-full border px-2.5 py-0.5 ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:bg-accent"
      }`}
    >
      {children}
    </a>
  );
}
