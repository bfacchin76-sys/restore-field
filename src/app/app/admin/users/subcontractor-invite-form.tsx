"use client";

import { useActionState } from "react";
import { inviteSubcontractor, type SubLinkResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initial: SubLinkResult = { ok: false };

export function SubcontractorInviteForm() {
  const [state, formAction, pending] = useActionState(
    inviteSubcontractor,
    initial,
  );

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto]"
    >
      <div className="space-y-2">
        <Label htmlFor="sub-name">Name</Label>
        <Input id="sub-name" name="name" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sub-email">Email</Label>
        <Input
          id="sub-email"
          name="email"
          type="email"
          autoComplete="off"
          required
        />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send magic link"}
        </Button>
      </div>
      {state.message ? (
        <div className="sm:col-span-3">
          <Alert variant={state.ok ? "success" : "destructive"}>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        </div>
      ) : null}
    </form>
  );
}
