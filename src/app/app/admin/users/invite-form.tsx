"use client";

import { useActionState } from "react";
import type { Role } from "@prisma/client";
import { inviteUser, type InviteResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initial: InviteResult = { ok: false };

export function InviteForm({ allowedRoles }: { allowedRoles: Role[] }) {
  const [state, formAction, pending] = useActionState(inviteUser, initial);

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto_auto]"
    >
      <div className="space-y-2">
        <Label htmlFor="invite-name">Name</Label>
        <Input id="invite-name" name="name" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          autoComplete="off"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-role">Role</Label>
        <select
          id="invite-role"
          name="role"
          required
          defaultValue="TECH"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {allowedRoles.map((r) => (
            <option key={r} value={r}>
              {r.replace("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send invite"}
        </Button>
      </div>
      {state.message ? (
        <div className="sm:col-span-4">
          <Alert variant={state.ok ? "success" : "destructive"}>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        </div>
      ) : null}
    </form>
  );
}
