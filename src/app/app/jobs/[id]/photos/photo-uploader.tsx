"use client";

import { useRef, useState, useTransition } from "react";
import {
  finalizePhotoUploads,
  presignPhotoUploads,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif";

interface UploaderProps {
  jobId: string;
  rooms: Array<{ id: string; name: string }>;
}

interface QueueItem {
  localId: string;
  file: File;
  progress: number; // 0..100
  status: "queued" | "uploading" | "uploaded" | "error";
  error?: string;
}

export function PhotoUploader({ jobId, rooms }: UploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [defaultRoomId, setDefaultRoomId] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<{ count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const accept = (files: File[]) => {
    setError(null);
    setDone(null);
    const valid = files.filter((f) => f.size > 0 && f.size <= 50 * 1024 * 1024);
    if (valid.length === 0) {
      setError("No valid image files selected (max 50 MB each).");
      return;
    }
    if (valid.length !== files.length) {
      setError(`Skipped ${files.length - valid.length} oversized file(s).`);
    }
    setQueue(
      valid.map((file, i) => ({
        localId: `${Date.now()}-${i}`,
        file,
        progress: 0,
        status: "queued",
      })),
    );
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    accept(files);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    accept(files);
  };

  const setItem = (localId: string, patch: Partial<QueueItem>) =>
    setQueue((q) =>
      q.map((it) => (it.localId === localId ? { ...it, ...patch } : it)),
    );

  const upload = () => {
    if (queue.length === 0) return;
    startTransition(async () => {
      try {
        const presigned = await presignPhotoUploads({
          jobId,
          files: queue.map((it) => ({
            filename: it.file.name,
            mimeType: it.file.type || "image/jpeg",
            size: it.file.size,
          })),
        });
        if (!presigned.ok) {
          setError(presigned.message);
          return;
        }

        const finalized: Array<{
          photoId: string;
          uploadKey: string;
          mimeType: string;
        }> = [];

        for (let i = 0; i < queue.length; i++) {
          const item = queue[i];
          const slot = presigned.uploads[i];
          setItem(item.localId, { status: "uploading", progress: 0 });
          try {
            await uploadOne(slot.url, slot.headers, item.file, (p) =>
              setItem(item.localId, { progress: p }),
            );
            setItem(item.localId, { status: "uploaded", progress: 100 });
            finalized.push({
              photoId: slot.photoId,
              uploadKey: slot.uploadKey,
              mimeType: slot.mimeType,
            });
          } catch (err) {
            setItem(item.localId, {
              status: "error",
              error: err instanceof Error ? err.message : "Upload failed",
            });
          }
        }

        if (finalized.length > 0) {
          const r = await finalizePhotoUploads({
            jobId,
            uploads: finalized.map((f) => ({
              ...f,
              roomId: defaultRoomId || null,
            })),
          });
          if (!r.ok) setError(r.message ?? "Finalize failed");
          else setDone({ count: finalized.length });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload error");
      }
    });
  };

  const reset = () => {
    setQueue([]);
    setDone(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-3">
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/30"
        }`}
      >
        <p className="text-sm font-medium">Drop photos here, or…</p>
        <p className="mt-1 text-xs text-muted-foreground">
          JPEG, PNG, WebP, HEIC up to 50 MB each.
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
          >
            Choose files
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (!inputRef.current) return;
              inputRef.current.setAttribute("capture", "environment");
              inputRef.current.click();
              setTimeout(() => inputRef.current?.removeAttribute("capture"), 0);
            }}
            disabled={pending}
          >
            Take photo
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          onChange={onPick}
          className="hidden"
        />
      </div>

      {queue.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium uppercase text-muted-foreground">
              Default room:
            </label>
            <select
              value={defaultRoomId}
              onChange={(e) => setDefaultRoomId(e.target.value)}
              className="flex h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">— unassigned —</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              onClick={upload}
              disabled={pending}
            >
              {pending
                ? `Uploading ${queue.filter((q) => q.status === "uploaded").length}/${queue.length}…`
                : `Upload ${queue.length}`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={reset}
              disabled={pending}
            >
              Clear
            </Button>
          </div>

          <ul className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-3">
            {queue.map((it) => (
              <li
                key={it.localId}
                className="flex items-center gap-2 rounded-md border border-border px-2 py-1"
              >
                <span className="flex-1 truncate" title={it.file.name}>
                  {it.file.name}
                </span>
                <span
                  className={
                    it.status === "uploaded"
                      ? "text-emerald-600"
                      : it.status === "error"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  {it.status === "uploaded"
                    ? "✓"
                    : it.status === "error"
                      ? "✕"
                      : it.status === "uploading"
                        ? `${it.progress}%`
                        : "…"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {done ? (
        <Alert variant="success">
          <AlertDescription>
            Uploaded {done.count} photo{done.count === 1 ? "" : "s"}.
            Processing in the background — refresh to see thumbnails.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function uploadOne(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText.slice(0, 120)}`));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(file);
  });
}
