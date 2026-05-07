"use client";

import { useTransition } from "react";
import type { EquipmentType } from "@prisma/client";
import { removePlacement } from "./actions";
import { Button } from "@/components/ui/button";

interface PlacementVm {
  id: string;
  assetTag: string;
  type: EquipmentType;
  manufacturer: string | null;
  model: string | null;
  roomName: string | null;
  placedAt: string;
  removedAt: string | null;
  notes: string | null;
}

export function PlacementRow({
  jobId,
  placement,
  canEdit,
}: {
  jobId: string;
  placement: PlacementVm;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <tr className="border-b last:border-b-0">
      <td className="px-6 py-2 font-mono text-xs">{placement.assetTag}</td>
      <td className="px-6 py-2 text-xs uppercase">
        {placement.type.replace(/_/g, " ").toLowerCase()}
      </td>
      <td className="px-6 py-2 text-xs">{placement.roomName ?? "—"}</td>
      <td className="px-6 py-2 text-xs text-muted-foreground">
        {new Date(placement.placedAt).toLocaleString()}
      </td>
      <td className="px-6 py-2 text-xs text-muted-foreground">
        {placement.notes ?? ""}
      </td>
      {canEdit ? (
        <td className="px-6 py-2 text-right">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Remove ${placement.assetTag} from this job?`)) return;
              startTransition(async () => {
                try {
                  await removePlacement({ jobId, placementId: placement.id });
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Failed");
                }
              });
            }}
          >
            Remove
          </Button>
        </td>
      ) : null}
    </tr>
  );
}
