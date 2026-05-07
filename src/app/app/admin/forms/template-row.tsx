"use client";

import { useState, useTransition } from "react";
import {
  setFormTemplateActive,
  updateFormTemplate,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TemplateRow({
  template,
}: {
  template: {
    id: string;
    name: string;
    schema: string;
    bodyTemplate: string;
    active: boolean;
  };
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(template.name);
  const [schema, setSchema] = useState(template.schema);
  const [body, setBody] = useState(template.bodyTemplate);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        await updateFormTemplate({
          templateId: template.id,
          name,
          schema,
          bodyTemplate: body,
        });
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    });
  };

  const toggleActive = () =>
    startTransition(async () => {
      try {
        await setFormTemplateActive({
          templateId: template.id,
          active: !template.active,
        });
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed");
      }
    });

  return (
    <li className="px-6 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{template.name}</p>
          <p className="text-xs text-muted-foreground">
            {template.active ? "Active" : "Inactive"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={toggleActive}
          >
            {template.active ? "Deactivate" : "Activate"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Schema (JSON)</Label>
            <textarea
              rows={10}
              value={schema}
              onChange={(e) => setSchema(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Body (Handlebars HTML)</Label>
            <textarea
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
            />
          </div>
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : null}
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
