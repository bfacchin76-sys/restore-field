"use client";

import { useState, useTransition } from "react";
import type { Role } from "@prisma/client";
import { addAssignment, removeAssignment } from "./assignment-actions";
import { Button } from "@/components/ui/button";

interface AssignmentsProps {
  jobId: string;
  assignments: Array<{
    userId: string;
    role: string;
    name: string;
    userRole: Role;
  }>;
  candidates: Array<{ id: string; name: string; role: Role; email: string }>;
  canEdit: boolean;
}

const ROLE_OPTIONS = ["lead", "tech", "estimator", "subcontractor"] as const;

export function Assignments({
  jobId,
  assignments,
  candidates,
  canEdit,
}: AssignmentsProps) {
  const [pending, startTransition] = useTransition();
  const [pickedUser, setPickedUser] = useState("");
  const [pickedRole, setPickedRole] = useState<(typeof ROLE_OPTIONS)[number]>("tech");

  const assignedIds = new Set(assignments.map((a) => a.userId));
  const available = candidates.filter((c) => !assignedIds.has(c.id));

  return (
    <div className="space-y-3">
      {assignments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No assignments yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {assignments.map((a) => (
            <li
              key={a.userId}
              className="flex items-center justify-between gap-2 border-b py-1.5 last:border-b-0"
            >
              <span>
                <strong>{a.name}</strong>
                <span className="ml-2 text-xs uppercase text-muted-foreground">
                  {a.role}
                </span>
              </span>
              {canEdit ? (
                <button
                  type="button"
                  className="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        await removeAssignment({ jobId, userId: a.userId });
                      } catch (err) {
                        alert(err instanceof Error ? err.message : "Failed");
                      }
                    })
                  }
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit && available.length > 0 ? (
        <div className="space-y-2 border-t pt-3">
          <p className="text-xs uppercase text-muted-foreground">Add</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
            <select
              value={pickedUser}
              onChange={(e) => setPickedUser(e.target.value)}
              className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Pick a teammate…</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.role.replace("_", " ").toLowerCase()}
                </option>
              ))}
            </select>
            <select
              value={pickedRole}
              onChange={(e) => setPickedRole(e.target.value as typeof pickedRole)}
              className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              disabled={!pickedUser || pending}
              onClick={() =>
                startTransition(async () => {
                  if (!pickedUser) return;
                  try {
                    await addAssignment({
                      jobId,
                      userId: pickedUser,
                      role: pickedRole,
                    });
                    setPickedUser("");
                  } catch (err) {
                    alert(err instanceof Error ? err.message : "Failed");
                  }
                })
              }
            >
              Add
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
