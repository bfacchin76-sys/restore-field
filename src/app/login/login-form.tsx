"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  loginAction,
  type LoginActionResult,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initial: LoginActionResult = { ok: false };

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initial);
  const showTotp = Boolean(state.needsTotp);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Sign in to RestoreField</CardTitle>
        <CardDescription>
          Use your work email and password.
        </CardDescription>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-primary hover:underline"
              >
                Forgot?
              </Link>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          {showTotp ? (
            <div className="space-y-2">
              <Label htmlFor="totp">6-digit authenticator code</Label>
              <Input
                id="totp"
                name="totp"
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                placeholder="123456"
                required
              />
            </div>
          ) : (
            // Keep the field present so its value is submitted on retry
            <input type="hidden" name="totp" value="" />
          )}
          {state.message ? (
            <Alert variant={state.ok ? "success" : "destructive"}>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : showTotp ? "Verify code" : "Sign in"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
