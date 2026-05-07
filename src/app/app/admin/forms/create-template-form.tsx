"use client";

import { useActionState, useState } from "react";
import {
  createFormTemplate,
  type TemplateActionResult,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initial: TemplateActionResult = { ok: false };

interface Props {
  sampleAobSchema: string;
  sampleAobBody: string;
  sampleCocSchema: string;
  sampleCocBody: string;
}

export function CreateTemplateForm({
  sampleAobSchema,
  sampleAobBody,
  sampleCocSchema,
  sampleCocBody,
}: Props) {
  const [state, formAction, pending] = useActionState(createFormTemplate, initial);
  const [name, setName] = useState("");
  const [schema, setSchema] = useState("");
  const [body, setBody] = useState("");

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Start from a default:</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setName("Authorization to Perform Services");
            setSchema(sampleAobSchema);
            setBody(sampleAobBody);
          }}
        >
          AOB
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setName("Certificate of Completion");
            setSchema(sampleCocSchema);
            setBody(sampleCocBody);
          }}
        >
          COC
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="t-name">Name</Label>
        <Input
          id="t-name"
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {state.fieldErrors?.name ? (
          <p className="text-xs text-destructive">{state.fieldErrors.name}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="t-schema">Schema (JSON)</Label>
        <textarea
          id="t-schema"
          name="schema"
          required
          rows={10}
          value={schema}
          onChange={(e) => setSchema(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
        />
        {state.fieldErrors?.schema ? (
          <p className="text-xs text-destructive">{state.fieldErrors.schema}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="t-body">Body template (Handlebars HTML)</Label>
        <textarea
          id="t-body"
          name="bodyTemplate"
          required
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Available variables: <code>{`{{customer.firstName}}`}</code>,{" "}
          <code>{`{{customer.lastName}}`}</code>,{" "}
          <code>{`{{customer.addressLine1}}`}</code>,{" "}
          <code>{`{{job.jobNumber}}`}</code>,{" "}
          <code>{`{{date job.lossDate}}`}</code>,{" "}
          <code>{`{{org.name}}`}</code>, plus any field id from the schema.
        </p>
      </div>

      {state.message ? (
        <Alert variant={state.ok ? "success" : "destructive"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Create template"}
        </Button>
      </div>
    </form>
  );
}
