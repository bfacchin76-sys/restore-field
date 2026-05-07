"use client";

import { useTransition } from "react";
import { Role } from "@prisma/client";
import { setUserActive, updateUserRole } from "./actions";
import { Button } from "@/components/ui/button";

interface UserRowProps {
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    active: boolean;
    lastLoginAt: Date | null;
    totpSecret: string | null;
  };
  actorRole: Role;
  actorId: string;
  allRoles: Role[];
}

export function UserRow({ user, actorRole, actorId, allRoles }: UserRowProps) {
  const [pending, startTransition] = useTransition();
  const isSelf = user.id === actorId;
  const ownerLocked = user.role === "OWNER" && actorRole !== "OWNER";

  // Role choices visible to this actor
  const roleChoices = allRoles.filter((r) => {
    if (r === "OWNER" && actorRole !== "OWNER") return false;
    return true;
  });

  return (
    <tr className="border-b last:border-b-0">
      <td className="px-6 py-3 font-medium">{user.name}</td>
      <td className="px-6 py-3 text-muted-foreground">{user.email}</td>
      <td className="px-6 py-3">
        <select
          value={user.role}
          disabled={pending || isSelf || ownerLocked}
          onChange={(e) =>
            startTransition(async () => {
              try {
                await updateUserRole({
                  userId: user.id,
                  role: e.target.value as Role,
                });
              } catch (err) {
                alert(err instanceof Error ? err.message : "Update failed");
              }
            })
          }
          className="rounded-md border border-input bg-background px-2 py-1 text-sm disabled:opacity-50"
        >
          {roleChoices.map((r) => (
            <option key={r} value={r}>
              {r.replace("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
      </td>
      <td className="px-6 py-3 text-xs text-muted-foreground">
        {user.totpSecret ? "enabled" : "—"}
      </td>
      <td className="px-6 py-3 text-xs text-muted-foreground">
        {user.lastLoginAt
          ? new Date(user.lastLoginAt).toLocaleString()
          : "never"}
      </td>
      <td className="px-6 py-3 text-xs">
        {user.active ? (
          <span className="text-emerald-600">Active</span>
        ) : (
          <span className="text-muted-foreground">Disabled</span>
        )}
      </td>
      <td className="px-6 py-3 text-right">
        <Button
          type="button"
          variant={user.active ? "destructive" : "default"}
          size="sm"
          disabled={pending || isSelf || ownerLocked}
          onClick={() =>
            startTransition(async () => {
              try {
                await setUserActive({
                  userId: user.id,
                  active: !user.active,
                });
              } catch (err) {
                alert(err instanceof Error ? err.message : "Update failed");
              }
            })
          }
        >
          {user.active ? "Deactivate" : "Reactivate"}
        </Button>
      </td>
    </tr>
  );
}
