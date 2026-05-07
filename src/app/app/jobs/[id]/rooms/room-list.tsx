"use client";

import { useState, useTransition } from "react";
import type { WaterCategory, WaterClass } from "@prisma/client";
import { deleteRoom, reorderRooms } from "./actions";
import { RoomForm } from "./room-form";
import { Button } from "@/components/ui/button";
import { affectedMaterialLabel } from "@/lib/business/affected-materials";

interface RoomListItem {
  id: string;
  name: string;
  floor: string | null;
  lengthFt: number | null;
  widthFt: number | null;
  heightFt: number | null;
  category: WaterCategory | null;
  classOfLoss: WaterClass | null;
  notes: string | null;
  affectedMaterials: string[];
}

interface RoomListProps {
  jobId: string;
  rooms: RoomListItem[];
  allMaterials: string[];
  canEdit: boolean;
}

export function RoomList({ jobId, rooms, allMaterials, canEdit }: RoomListProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (rooms.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No rooms yet. Use the form to add the first one.
      </p>
    );
  }

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= rooms.length) return;
    const next = rooms.map((r) => r.id);
    [next[idx], next[target]] = [next[target], next[idx]];
    startTransition(async () => {
      try {
        await reorderRooms({ jobId, orderedRoomIds: next });
      } catch (err) {
        alert(err instanceof Error ? err.message : "Reorder failed");
      }
    });
  };

  return (
    <ul className="space-y-3">
      {rooms.map((r, idx) => {
        const sqft =
          r.lengthFt && r.widthFt ? Math.round(r.lengthFt * r.widthFt) : null;
        const isEditing = editing === r.id;
        return (
          <li
            key={r.id}
            className="rounded-md border border-border bg-card p-3"
          >
            {isEditing ? (
              <RoomForm
                mode="edit"
                jobId={jobId}
                room={r}
                allMaterials={allMaterials}
                onDone={() => setEditing(null)}
              />
            ) : (
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.floor ?? "—"}
                      {sqft ? ` · ${sqft} sq ft` : ""}
                      {r.category
                        ? ` · ${r.category.replace("CAT_", "Cat ")}`
                        : ""}
                      {r.classOfLoss
                        ? ` · ${r.classOfLoss.replace("CLASS_", "Class ")}`
                        : ""}
                    </p>
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label="Move up"
                        title="Move up"
                        disabled={pending || idx === 0}
                        onClick={() => move(idx, -1)}
                        className="rounded border border-input px-2 py-1 text-xs disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        title="Move down"
                        disabled={pending || idx === rooms.length - 1}
                        onClick={() => move(idx, 1)}
                        className="rounded border border-input px-2 py-1 text-xs disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(r.id)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          if (
                            !confirm(
                              `Delete ${r.name}? Photos and readings tied to this room will lose their room link.`,
                            )
                          )
                            return;
                          startTransition(async () => {
                            try {
                              await deleteRoom({ jobId, roomId: r.id });
                            } catch (err) {
                              alert(
                                err instanceof Error ? err.message : "Failed",
                              );
                            }
                          });
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </div>
                {r.affectedMaterials.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {r.affectedMaterials.map((m) => (
                      <span
                        key={m}
                        className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground"
                      >
                        {affectedMaterialLabel(m)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {r.notes ? (
                  <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">
                    {r.notes}
                  </p>
                ) : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
