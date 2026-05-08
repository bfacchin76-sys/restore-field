"use client";

import { useState, useTransition } from "react";
import { createNoteAction, deleteNoteAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface NoteVm {
  id: string;
  content: string;
  authorName: string;
  authorId: string;
  createdAt: string;
  /** Set when the note is queued offline. */
  pending?: boolean;
}

export function NotesPanel({
  jobId,
  actorId,
  canEdit,
  notes,
}: {
  jobId: string;
  actorId: string;
  canEdit: boolean;
  notes: NoteVm[];
}) {
  const [content, setContent] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<NoteVm[]>([]);

  const submit = () => {
    if (!content.trim()) return;
    setError(null);
    const text = content.trim();
    setContent("");
    startTransition(async () => {
      // If we're offline, queue locally and show optimistically.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        try {
          const { enqueueNote } = await import("@/lib/offline/sync");
          await enqueueNote({ jobId, content: text });
          setOptimistic((prev) => [
            {
              id: `pending-${Date.now()}`,
              content: text,
              authorName: "you (offline)",
              authorId: actorId,
              createdAt: new Date().toISOString(),
              pending: true,
            },
            ...prev,
          ]);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to queue.");
        }
        return;
      }

      try {
        const r = await createNoteAction({ jobId, content: text });
        if (!r.ok) setError(r.message ?? "Failed");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  };

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="space-y-2">
          <textarea
            rows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Field notes — observations, customer interactions, scope changes…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-2">
            <Button type="button" disabled={pending || !content.trim()} onClick={submit}>
              {pending ? "Saving…" : "Add note"}
            </Button>
            <span className="text-xs text-muted-foreground">
              When you&apos;re offline, notes queue locally and sync when you
              reconnect.
            </span>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

      {optimistic.length === 0 && notes.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No notes yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {[...optimistic, ...notes].map((n) => (
            <li
              key={n.id}
              className={`rounded-md border bg-card px-3 py-2 text-sm ${
                n.pending ? "border-amber-300 bg-amber-50" : "border-border"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  <strong className="text-foreground">{n.authorName}</strong>
                  {" · "}
                  {new Date(n.createdAt).toLocaleString()}
                  {n.pending ? " · queued" : ""}
                </span>
                {canEdit && !n.pending && n.authorId === actorId ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-destructive hover:underline"
                    onClick={() => {
                      if (!confirm("Delete this note?")) return;
                      void deleteNoteAction({ noteId: n.id });
                    }}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap">{n.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
