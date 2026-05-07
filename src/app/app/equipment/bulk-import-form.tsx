"use client";

import { useActionState } from "react";
import { bulkImportEquipment, type BulkImportResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initial: BulkImportResult = {
  ok: false,
  imported: 0,
  skipped: 0,
  errors: [],
};

export function BulkImportForm() {
  const [state, formAction, pending] = useActionState(
    bulkImportEquipment,
    initial,
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="csv-input">CSV body</Label>
        <textarea
          id="csv-input"
          name="csv"
          rows={6}
          required
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          placeholder={`assetTag,type,manufacturer,model,serialNumber,amperage,cfm,ppd,status,notes\nAM-100,AIR_MOVER,Phoenix,Axial,SN-1,1.5,2900,,AVAILABLE,`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Importing…" : "Import"}
        </Button>
        {state.imported || state.skipped ? (
          <span className="text-xs text-muted-foreground">
            Imported {state.imported}
            {state.skipped > 0 ? ` · skipped ${state.skipped}` : ""}
          </span>
        ) : null}
      </div>
      {state.errors.length > 0 ? (
        <Alert variant={state.ok ? "default" : "destructive"}>
          <AlertDescription>
            <ul className="list-disc pl-5 text-xs">
              {state.errors.slice(0, 8).map((e, i) => (
                <li key={i}>
                  {e.line > 0 ? `Line ${e.line}: ` : ""}
                  {e.message}
                </li>
              ))}
              {state.errors.length > 8 ? (
                <li>…and {state.errors.length - 8} more.</li>
              ) : null}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
