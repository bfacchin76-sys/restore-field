"use client";

import { useActionState } from "react";
import {
  createCustomer,
  updateCustomer,
  type CustomerActionResult,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface CustomerFormProps {
  customer?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    postalCode: string;
    insuranceCarrier: string | null;
    policyNumber: string | null;
    claimNumber: string | null;
    adjusterName: string | null;
    adjusterEmail: string | null;
    adjusterPhone: string | null;
  };
}

const initial: CustomerActionResult = { ok: false };

export function CustomerForm({ customer }: CustomerFormProps) {
  const action = customer
    ? updateCustomer.bind(null, customer.id)
    : createCustomer;
  const [state, formAction, pending] = useActionState(action, initial);

  const v = (key: keyof NonNullable<CustomerFormProps["customer"]>) =>
    customer ? customer[key] ?? "" : "";

  const err = (key: string) => state.fieldErrors?.[key];

  return (
    <form action={formAction} className="space-y-6">
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Contact</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={err("firstName")}>
            <Input name="firstName" defaultValue={v("firstName")} required />
          </Field>
          <Field label="Last name" error={err("lastName")}>
            <Input name="lastName" defaultValue={v("lastName")} required />
          </Field>
          <Field label="Email" error={err("email")}>
            <Input name="email" type="email" defaultValue={v("email")} />
          </Field>
          <Field label="Phone" error={err("phone")}>
            <Input name="phone" type="tel" defaultValue={v("phone")} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Loss address</legend>
        <Field label="Street" error={err("addressLine1")}>
          <Input
            name="addressLine1"
            defaultValue={v("addressLine1")}
            required
          />
        </Field>
        <Field label="Apt / suite" error={err("addressLine2")}>
          <Input name="addressLine2" defaultValue={v("addressLine2")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City" error={err("city")}>
            <Input name="city" defaultValue={v("city")} required />
          </Field>
          <Field label="State" error={err("state")}>
            <Input
              name="state"
              defaultValue={v("state") || "NY"}
              maxLength={2}
              required
            />
          </Field>
          <Field label="ZIP" error={err("postalCode")}>
            <Input name="postalCode" defaultValue={v("postalCode")} required />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Insurance (optional)</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Carrier" error={err("insuranceCarrier")}>
            <Input
              name="insuranceCarrier"
              defaultValue={v("insuranceCarrier")}
            />
          </Field>
          <Field label="Policy #" error={err("policyNumber")}>
            <Input name="policyNumber" defaultValue={v("policyNumber")} />
          </Field>
          <Field label="Claim #" error={err("claimNumber")}>
            <Input name="claimNumber" defaultValue={v("claimNumber")} />
          </Field>
          <Field label="Adjuster name" error={err("adjusterName")}>
            <Input name="adjusterName" defaultValue={v("adjusterName")} />
          </Field>
          <Field label="Adjuster email" error={err("adjusterEmail")}>
            <Input
              name="adjusterEmail"
              type="email"
              defaultValue={v("adjusterEmail")}
            />
          </Field>
          <Field label="Adjuster phone" error={err("adjusterPhone")}>
            <Input
              name="adjusterPhone"
              type="tel"
              defaultValue={v("adjusterPhone")}
            />
          </Field>
        </div>
      </fieldset>

      {state.message ? (
        <Alert variant={state.ok ? "success" : "destructive"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : customer ? "Save changes" : "Create customer"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
