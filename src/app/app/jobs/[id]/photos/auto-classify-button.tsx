"use client";

import { useTransition, useState } from "react";
import { autoClassifyFirePhotos } from "./auto-classify-action";
import { Button } from "@/components/ui/button";

export function AutoClassifyButton({ jobId }: { jobId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {result ? (
        <span className="text-xs text-muted-foreground">{result}</span>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await autoClassifyFirePhotos({ jobId });
            setResult(
              r.ok
                ? `Classified ${r.updated} photo${r.updated === 1 ? "" : "s"}.`
                : (r.message ?? "Failed"),
            );
          })
        }
      >
        {pending ? "Classifying…" : "Auto-classify"}
      </Button>
    </div>
  );
}
