"use client";

import dynamicImport from "next/dynamic";
import { useActionState, useState } from "react";
import type { FormSchema, FormValues } from "@/lib/forms/templates";
import { submitSignedForm, type SignActionResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Signature canvas pulls in DOM APIs; load client-side only.
const SignaturePad = dynamicImport(() => import("./signature-pad"), {
  ssr: false,
  loading: () => (
    <div className="flex h-40 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
      Loading signature pad…
    </div>
  ),
});

const initial: SignActionResult = { ok: false };

export function SignForm({
  token,
  schema,
  initialValues,
  recipientEmail,
}: {
  token: string;
  schema: FormSchema;
  initialValues: FormValues;
  recipientEmail: string;
}) {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [state, formAction, pending] = useActionState(submitSignedForm, initial);

  const setVal = (id: string, v: string | boolean) =>
    setValues((prev) => ({ ...prev, [id]: v }));

  if (state.ok) {
    return (
      <Alert variant="success">
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input
        type="hidden"
        name="valuesJson"
        value={JSON.stringify(values)}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Your name (for signing)">
          <Input
            name="signerName"
            required
            defaultValue={
              typeof initialValues.customerName === "string"
                ? initialValues.customerName
                : ""
            }
          />
        </Field>
        <Field label="Email (optional)">
          <Input
            name="signerEmail"
            type="email"
            defaultValue={recipientEmail}
          />
        </Field>
      </div>

      {schema.fields.map((field) => {
        if (field.type === "signature") {
          const v =
            typeof values[field.id] === "string"
              ? (values[field.id] as string)
              : "";
          return (
            <div key={field.id} className="space-y-1.5">
              <Label>
                {field.label}
                {field.required ? " *" : ""}
              </Label>
              <SignaturePad
                value={v}
                onChange={(dataUrl) => setVal(field.id, dataUrl)}
              />
            </div>
          );
        }
        if (field.type === "textarea") {
          const v =
            typeof values[field.id] === "string"
              ? (values[field.id] as string)
              : "";
          return (
            <div key={field.id} className="space-y-1.5">
              <Label htmlFor={`f-${field.id}`}>
                {field.label}
                {field.required ? " *" : ""}
              </Label>
              <textarea
                id={`f-${field.id}`}
                value={v}
                onChange={(e) => setVal(field.id, e.target.value)}
                rows={4}
                required={field.required}
                placeholder={field.placeholder}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          );
        }
        if (field.type === "checkbox") {
          const v =
            typeof values[field.id] === "boolean"
              ? (values[field.id] as boolean)
              : false;
          return (
            <label
              key={field.id}
              className="flex items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={v}
                onChange={(e) => setVal(field.id, e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              {field.label}
              {field.required ? " *" : ""}
            </label>
          );
        }
        const v =
          typeof values[field.id] === "string"
            ? (values[field.id] as string)
            : "";
        return (
          <div key={field.id} className="space-y-1.5">
            <Label htmlFor={`f-${field.id}`}>
              {field.label}
              {field.required ? " *" : ""}
            </Label>
            <Input
              id={`f-${field.id}`}
              type={
                field.type === "date"
                  ? "date"
                  : field.type === "email"
                    ? "email"
                    : "text"
              }
              value={v}
              onChange={(e) => setVal(field.id, e.target.value)}
              required={field.required}
              placeholder={field.placeholder}
            />
          </div>
        );
      })}

      {state.message ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Signing…" : "Sign and submit"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
