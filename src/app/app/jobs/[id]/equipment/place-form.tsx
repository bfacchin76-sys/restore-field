"use client";

import { useState, useTransition } from "react";
import type { EquipmentType } from "@prisma/client";
import { placeEquipmentOnJob } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface PlaceFormProps {
  jobId: string;
  rooms: Array<{ id: string; name: string }>;
  available: Array<{
    id: string;
    assetTag: string;
    type: EquipmentType;
    manufacturer: string | null;
    model: string | null;
  }>;
}

export function PlaceEquipmentForm({
  jobId,
  rooms,
  available,
}: PlaceFormProps) {
  const [equipmentId, setEquipmentId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!equipmentId) {
          setError("Pick a unit to place.");
          return;
        }
        startTransition(async () => {
          try {
            await placeEquipmentOnJob({
              jobId,
              equipmentId,
              roomId: roomId || null,
              notes: notes.trim() || null,
            });
            setEquipmentId("");
            setRoomId("");
            setNotes("");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed");
          }
        });
      }}
      className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
    >
      <div className="space-y-1.5">
        <Label htmlFor="pe-eq">Available unit</Label>
        <select
          id="pe-eq"
          value={equipmentId}
          onChange={(e) => setEquipmentId(e.target.value)}
          required
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Pick a unit…</option>
          {available.map((eq) => (
            <option key={eq.id} value={eq.id}>
              {eq.assetTag} — {eq.type.replace(/_/g, " ").toLowerCase()}
              {eq.manufacturer ? ` (${eq.manufacturer}${eq.model ? ` ${eq.model}` : ""})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pe-room">Room (optional)</Label>
        <select
          id="pe-room"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">— unspecified —</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pe-notes">Notes</Label>
        <Input
          id="pe-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="orientation, target wall, etc."
        />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Placing…" : "Place"}
        </Button>
      </div>

      {error ? (
        <div className="sm:col-span-4">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}
    </form>
  );
}
