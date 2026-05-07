"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSketch } from "./actions";
import { Button } from "@/components/ui/button";

export function SketchesActions({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const r = await createSketch({ jobId, name: "Floor 1" });
            router.push(`/app/jobs/${jobId}/sketches/${r.sketchId}`);
          } catch (err) {
            alert(err instanceof Error ? err.message : "Failed");
          }
        })
      }
    >
      {pending ? "Creating…" : "New sketch"}
    </Button>
  );
}
