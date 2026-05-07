"use client";

import { useActionState } from "react";
import { WaterCategory, WaterClass } from "@prisma/client";
import { createRoom, updateRoom, type RoomActionResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { affectedMaterialLabel } from "@/lib/business/affected-materials";

const initial: RoomActionResult = { ok: false };

interface BaseProps {
  jobId: string;
  allMaterials: string[];
  onDone?: () => void;
}

interface CreateProps extends BaseProps {
  mode?: "create";
  room?: undefined;
}

interface EditProps extends BaseProps {
  mode: "edit";
  room: {
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
  };
}

type Props = CreateProps | EditProps;

export function RoomForm(props: Props) {
  const action =
    props.mode === "edit"
      ? updateRoom.bind(null, props.jobId, props.room.id)
      : createRoom.bind(null, props.jobId);
  const [state, formAction, pending] = useActionState(action, initial);

  const room = props.mode === "edit" ? props.room : undefined;
  const checkedMaterials = new Set(room?.affectedMaterials ?? []);
  const err = (k: string) => state.fieldErrors?.[k];

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rf-name">Room name</Label>
          <Input
            id="rf-name"
            name="name"
            defaultValue={room?.name ?? ""}
            placeholder="Kitchen"
            required
          />
          {err("name") ? (
            <p className="text-xs font-medium text-destructive">{err("name")}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rf-floor">Floor</Label>
          <Input
            id="rf-floor"
            name="floor"
            defaultValue={room?.floor ?? ""}
            placeholder="1st floor"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rf-len">Length (ft)</Label>
          <Input
            id="rf-len"
            name="lengthFt"
            type="number"
            step="0.1"
            min="0"
            defaultValue={room?.lengthFt ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rf-wid">Width (ft)</Label>
          <Input
            id="rf-wid"
            name="widthFt"
            type="number"
            step="0.1"
            min="0"
            defaultValue={room?.widthFt ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rf-h">Height (ft)</Label>
          <Input
            id="rf-h"
            name="heightFt"
            type="number"
            step="0.1"
            min="0"
            defaultValue={room?.heightFt ?? "8"}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rf-cat">Water category</Label>
          <select
            id="rf-cat"
            name="category"
            defaultValue={room?.category ?? ""}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            {Object.values(WaterCategory).map((c) => (
              <option key={c} value={c}>
                {c.replace("CAT_", "Cat ")}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rf-class">Class of loss</Label>
          <select
            id="rf-class"
            name="classOfLoss"
            defaultValue={room?.classOfLoss ?? ""}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            {Object.values(WaterClass).map((c) => (
              <option key={c} value={c}>
                {c.replace("CLASS_", "Class ")}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium uppercase text-muted-foreground">
          Affected materials
        </legend>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {props.allMaterials.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="affectedMaterials"
                value={m}
                defaultChecked={checkedMaterials.has(m)}
                className="h-4 w-4 rounded border-input"
              />
              {affectedMaterialLabel(m)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="rf-notes">Notes</Label>
        <textarea
          id="rf-notes"
          name="notes"
          rows={3}
          defaultValue={room?.notes ?? ""}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      {state.message ? (
        <Alert variant={state.ok ? "success" : "destructive"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : props.mode === "edit" ? "Save room" : "Add room"}
        </Button>
        {props.mode === "edit" && props.onDone ? (
          <Button type="button" variant="ghost" onClick={props.onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
