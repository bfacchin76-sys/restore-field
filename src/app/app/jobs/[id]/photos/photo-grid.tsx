"use client";

import { useMemo, useState, useTransition } from "react";
import type { Salvageability } from "@prisma/client";
import {
  bulkUpdatePhotos,
  deletePhoto,
  updatePhoto,
} from "./actions";
import { Button } from "@/components/ui/button";

interface PhotoVm {
  id: string;
  roomId: string | null;
  caption: string | null;
  tags: string[];
  salvageability: Salvageability | null;
  width: number | null;
  height: number | null;
  takenAt: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  processedAt: string | null;
  processingError: string | null;
  thumbUrl: string | null;
  mediumUrl: string | null;
  originalUrl: string | null;
}

interface PhotoGridProps {
  jobId: string;
  rooms: Array<{ id: string; name: string }>;
  photos: PhotoVm[];
  canEdit: boolean;
  isFireJob: boolean;
}

export function PhotoGrid({
  jobId,
  rooms,
  photos,
  canEdit,
  isFireJob,
}: PhotoGridProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const roomById = useMemo(
    () => new Map(rooms.map((r) => [r.id, r.name] as const)),
    [rooms],
  );

  if (photos.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No photos yet. Use the uploader above to add some.
      </p>
    );
  }

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const bulkSetRoom = (roomId: string | null) =>
    startTransition(async () => {
      try {
        await bulkUpdatePhotos({
          jobId,
          photoIds: [...selected],
          roomId,
        });
        clearSelection();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed");
      }
    });

  const bulkSetSalvageability = (s: Salvageability) =>
    startTransition(async () => {
      try {
        await bulkUpdatePhotos({
          jobId,
          photoIds: [...selected],
          salvageability: s,
        });
        clearSelection();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed");
      }
    });

  const bulkAddTag = (tag: string) => {
    if (!tag) return;
    startTransition(async () => {
      try {
        await bulkUpdatePhotos({
          jobId,
          photoIds: [...selected],
          addTags: [tag],
        });
        clearSelection();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed");
      }
    });
  };

  return (
    <>
      {selected.size > 0 ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-2 text-sm">
          <span className="font-medium">
            {selected.size} selected
          </span>
          <select
            disabled={pending}
            onChange={(e) =>
              bulkSetRoom(e.target.value === "" ? null : e.target.value)
            }
            defaultValue=""
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="" disabled>
              Set room…
            </option>
            <option value="">— unassigned —</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {isFireJob ? (
            <select
              disabled={pending}
              onChange={(e) =>
                e.target.value &&
                bulkSetSalvageability(e.target.value as Salvageability)
              }
              defaultValue=""
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="" disabled>
                Set salvageability…
              </option>
              <option value="SALVAGEABLE">salvageable</option>
              <option value="UNSALVAGEABLE">unsalvageable</option>
              <option value="REQUIRES_PROFESSIONAL_CLEANING">
                needs cleaning
              </option>
              <option value="PENDING_REVIEW">pending review</option>
            </select>
          ) : null}
          <input
            type="text"
            placeholder="Add tag…"
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const v = (e.target as HTMLInputElement).value.trim();
                if (v) {
                  bulkAddTag(v);
                  (e.target as HTMLInputElement).value = "";
                }
              }
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={clearSelection}
            disabled={pending}
          >
            Clear
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6">
        {photos.map((p, i) => (
          <Tile
            key={p.id}
            photo={p}
            roomName={p.roomId ? (roomById.get(p.roomId) ?? null) : null}
            selected={selected.has(p.id)}
            canEdit={canEdit}
            onToggle={() => toggle(p.id)}
            onOpen={() => setOpenIdx(i)}
          />
        ))}
      </div>

      {openIdx !== null ? (
        <Lightbox
          jobId={jobId}
          rooms={rooms}
          photos={photos}
          startIndex={openIdx}
          isFireJob={isFireJob}
          canEdit={canEdit}
          onClose={() => setOpenIdx(null)}
        />
      ) : null}
    </>
  );
}

function Tile({
  photo,
  roomName,
  selected,
  canEdit,
  onToggle,
  onOpen,
}: {
  photo: PhotoVm;
  roomName: string | null;
  selected: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const ready = !!photo.thumbUrl;
  return (
    <div
      className={`group relative aspect-square overflow-hidden rounded-md border bg-muted ${
        selected ? "ring-2 ring-primary ring-offset-2" : "border-border"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 block h-full w-full"
        aria-label={photo.caption ?? "Open photo"}
      >
        {ready ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.thumbUrl!}
            alt={photo.caption ?? ""}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
            {photo.processingError ? "error" : "processing…"}
          </div>
        )}
      </button>
      {canEdit ? (
        <label className="absolute left-1 top-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded bg-white/90 text-xs shadow">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5"
          />
        </label>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-1 text-[10px] text-white opacity-0 group-hover:opacity-100">
        {roomName ?? "unassigned"}
        {photo.salvageability ? ` · ${photo.salvageability.replace(/_/g, " ").toLowerCase()}` : ""}
      </div>
    </div>
  );
}

function Lightbox({
  jobId,
  rooms,
  photos,
  startIndex,
  isFireJob,
  canEdit,
  onClose,
}: {
  jobId: string;
  rooms: Array<{ id: string; name: string }>;
  photos: PhotoVm[];
  startIndex: number;
  isFireJob: boolean;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  const [pending, startTransition] = useTransition();
  const photo = photos[idx];
  void jobId;

  const next = () => setIdx((i) => (i + 1) % photos.length);
  const prev = () => setIdx((i) => (i - 1 + photos.length) % photos.length);

  const save = (patch: Parameters<typeof updatePhoto>[0]) =>
    startTransition(async () => {
      try {
        await updatePhoto(patch);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed");
      }
    });

  const remove = () =>
    startTransition(async () => {
      if (!confirm("Delete this photo?")) return;
      try {
        await deletePhoto({ photoId: photo.id });
        if (photos.length === 1) onClose();
        else setIdx((i) => (i >= photos.length - 1 ? 0 : i));
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed");
      }
    });

  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-50 flex bg-black/90"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "ArrowRight") next();
        if (e.key === "ArrowLeft") prev();
      }}
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <div className="relative flex flex-1 items-center justify-center p-4">
        {photo.mediumUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.mediumUrl}
            alt={photo.caption ?? ""}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <p className="text-white">processing…</p>
        )}
        <button
          type="button"
          onClick={prev}
          aria-label="Previous"
          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-white hover:bg-white/20"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={next}
          aria-label="Next"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-white hover:bg-white/20"
        >
          ›
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-full bg-white/10 px-3 py-1.5 text-white hover:bg-white/20"
        >
          ✕
        </button>
      </div>
      <aside className="w-80 shrink-0 overflow-y-auto bg-background p-4 text-sm">
        <p className="text-xs text-muted-foreground">
          {idx + 1} / {photos.length}
        </p>
        {photo.takenAt ? (
          <p className="text-xs text-muted-foreground">
            Taken {new Date(photo.takenAt).toLocaleString()}
          </p>
        ) : null}
        {photo.gpsLat !== null && photo.gpsLng !== null ? (
          <p className="text-xs text-muted-foreground">
            GPS {photo.gpsLat.toFixed(5)}, {photo.gpsLng.toFixed(5)}
          </p>
        ) : null}
        {photo.width && photo.height ? (
          <p className="text-xs text-muted-foreground">
            {photo.width}×{photo.height}
          </p>
        ) : null}

        <div className="my-3 h-px bg-border" />

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium uppercase text-muted-foreground">
              Caption
            </label>
            <textarea
              defaultValue={photo.caption ?? ""}
              disabled={!canEdit || pending}
              onBlur={(e) =>
                e.target.value !== (photo.caption ?? "") &&
                save({ photoId: photo.id, caption: e.target.value })
              }
              rows={3}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase text-muted-foreground">
              Room
            </label>
            <select
              defaultValue={photo.roomId ?? ""}
              disabled={!canEdit || pending}
              onChange={(e) =>
                save({
                  photoId: photo.id,
                  roomId: e.target.value === "" ? null : e.target.value,
                })
              }
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">— unassigned —</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          {isFireJob ? (
            <div>
              <label className="text-xs font-medium uppercase text-muted-foreground">
                Salvageability
              </label>
              <select
                defaultValue={photo.salvageability ?? ""}
                disabled={!canEdit || pending}
                onChange={(e) =>
                  save({
                    photoId: photo.id,
                    salvageability:
                      e.target.value === ""
                        ? null
                        : (e.target.value as Salvageability),
                  })
                }
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">— not set —</option>
                <option value="SALVAGEABLE">salvageable</option>
                <option value="UNSALVAGEABLE">unsalvageable</option>
                <option value="REQUIRES_PROFESSIONAL_CLEANING">
                  requires professional cleaning
                </option>
                <option value="PENDING_REVIEW">pending review</option>
              </select>
            </div>
          ) : null}
          <div>
            <label className="text-xs font-medium uppercase text-muted-foreground">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              defaultValue={photo.tags.join(", ")}
              disabled={!canEdit || pending}
              onBlur={(e) => {
                const next = e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter((t) => t.length);
                if (next.join(",") !== photo.tags.join(",")) {
                  save({ photoId: photo.id, tags: next });
                }
              }}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            />
          </div>
          {photo.processingError ? (
            <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              Processing failed: {photo.processingError}
            </p>
          ) : null}

          <div className="flex justify-between gap-2 pt-2">
            <a
              href={photo.originalUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-primary hover:underline"
            >
              View original
            </a>
            {canEdit ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={pending}
                onClick={remove}
              >
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
