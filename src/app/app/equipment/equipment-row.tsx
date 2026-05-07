"use client";

import Link from "next/link";
import { useTransition } from "react";
import type { EquipmentStatus, EquipmentType } from "@prisma/client";
import { setEquipmentRetired } from "./actions";
import { Button } from "@/components/ui/button";

interface EquipmentVm {
  id: string;
  assetTag: string;
  type: EquipmentType;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  amperage: number | null;
  cfm: number | null;
  ppd: number | null;
  status: EquipmentStatus;
  notes: string | null;
}

export function EquipmentRow({
  equipment,
  currentJob,
}: {
  equipment: EquipmentVm;
  currentJob: { id: string; jobNumber: string } | null;
}) {
  const [pending, startTransition] = useTransition();

  const specs: string[] = [];
  if (equipment.cfm) specs.push(`${equipment.cfm} CFM`);
  if (equipment.ppd) specs.push(`${equipment.ppd} PPD`);
  if (equipment.amperage) specs.push(`${equipment.amperage} A`);

  return (
    <tr className="border-b last:border-b-0">
      <td className="px-6 py-2 font-mono text-xs">{equipment.assetTag}</td>
      <td className="px-6 py-2 text-xs uppercase">
        {equipment.type.replace(/_/g, " ").toLowerCase()}
      </td>
      <td className="px-6 py-2 text-xs">
        {equipment.manufacturer ?? "—"}
        {equipment.model ? ` · ${equipment.model}` : ""}
        {equipment.serialNumber ? (
          <span className="text-muted-foreground"> · {equipment.serialNumber}</span>
        ) : null}
      </td>
      <td className="px-6 py-2 text-xs text-muted-foreground">
        {specs.length ? specs.join(" · ") : "—"}
      </td>
      <td className="px-6 py-2 text-xs">
        <StatusBadge status={equipment.status} />
      </td>
      <td className="px-6 py-2 text-xs">
        {currentJob ? (
          <Link
            href={`/app/jobs/${currentJob.id}/equipment`}
            className="font-mono text-primary hover:underline"
          >
            {currentJob.jobNumber}
          </Link>
        ) : (
          "—"
        )}
      </td>
      <td className="px-6 py-2 text-right">
        <Button
          type="button"
          variant={equipment.status === "RETIRED" ? "outline" : "destructive"}
          size="sm"
          disabled={pending || equipment.status === "DEPLOYED"}
          onClick={() =>
            startTransition(async () => {
              try {
                await setEquipmentRetired({
                  equipmentId: equipment.id,
                  retire: equipment.status !== "RETIRED",
                });
              } catch (err) {
                alert(err instanceof Error ? err.message : "Failed");
              }
            })
          }
        >
          {equipment.status === "RETIRED" ? "Reactivate" : "Retire"}
        </Button>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: EquipmentStatus }) {
  const palette: Record<EquipmentStatus, string> = {
    AVAILABLE: "bg-emerald-100 text-emerald-800",
    DEPLOYED: "bg-blue-100 text-blue-800",
    MAINTENANCE: "bg-amber-100 text-amber-800",
    RETIRED: "bg-slate-200 text-slate-700",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${palette[status]}`}
    >
      {status.toLowerCase()}
    </span>
  );
}
