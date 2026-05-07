"use client";

import Image from "next/image";
import { useActionState, useState, useTransition } from "react";
import {
  confirmTotpSetup,
  disableTotp,
  startTotpSetup,
  type TotpSetupResult,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initial: TotpSetupResult = { ok: false };

export function TotpManager({ enabled }: { enabled: boolean }) {
  const [setup, setSetup] = useState<TotpSetupResult | null>(null);
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmTotpSetup,
    initial,
  );
  const [disableState, disableAction, disablePending] = useActionState(
    disableTotp,
    initial,
  );
  const [pendingStart, startTransition] = useTransition();

  if (enabled) {
    return (
      <form action={disableAction} className="max-w-sm space-y-3">
        <Alert variant="success">
          <AlertDescription>
            Two-factor authentication is enabled.
          </AlertDescription>
        </Alert>
        <div className="space-y-2">
          <Label htmlFor="disable-code">
            Enter your current 6-digit code to disable
          </Label>
          <Input
            id="disable-code"
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            autoComplete="one-time-code"
            placeholder="123456"
            required
          />
        </div>
        {disableState.message ? (
          <Alert variant={disableState.ok ? "success" : "destructive"}>
            <AlertDescription>{disableState.message}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" variant="destructive" disabled={disablePending}>
          {disablePending ? "Disabling…" : "Disable 2FA"}
        </Button>
      </form>
    );
  }

  if (!setup?.ok) {
    return (
      <div className="space-y-3">
        {setup?.message ? (
          <Alert variant="destructive">
            <AlertDescription>{setup.message}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">
            Two-factor authentication is currently off.
          </p>
        )}
        <Button
          type="button"
          disabled={pendingStart}
          onClick={() =>
            startTransition(async () => {
              const r = await startTotpSetup();
              setSetup(r);
            })
          }
        >
          {pendingStart ? "Generating…" : "Set up 2FA"}
        </Button>
      </div>
    );
  }

  return (
    <form action={confirmAction} className="max-w-md space-y-4">
      <p className="text-sm text-muted-foreground">
        Scan this QR code with your authenticator app, then enter the 6-digit
        code it shows.
      </p>
      {setup.qrCodeDataUrl ? (
        <Image
          src={setup.qrCodeDataUrl}
          alt="TOTP QR code"
          width={200}
          height={200}
          className="rounded border bg-white p-2"
          unoptimized
        />
      ) : null}
      {setup.secret ? (
        <p className="break-all rounded-md bg-muted p-2 text-xs font-mono text-muted-foreground">
          Or enter this secret manually: <strong>{setup.secret}</strong>
        </p>
      ) : null}
      <input type="hidden" name="secret" value={setup.secret ?? ""} />
      <div className="space-y-2">
        <Label htmlFor="totp-code">6-digit code</Label>
        <Input
          id="totp-code"
          name="code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          autoComplete="one-time-code"
          placeholder="123456"
          required
        />
      </div>
      {confirmState.message ? (
        <Alert variant={confirmState.ok ? "success" : "destructive"}>
          <AlertDescription>{confirmState.message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={confirmPending}>
          {confirmPending ? "Verifying…" : "Verify and enable"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setSetup(null)}
          disabled={confirmPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
