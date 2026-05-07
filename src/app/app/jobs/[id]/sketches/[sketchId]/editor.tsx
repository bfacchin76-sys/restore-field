"use client";

import dynamic from "next/dynamic";
import type { SketchScene } from "@/lib/business/sketch/types";

// Konva touches `window` on load, so the editor must be client-only.
const SketchEditorImpl = dynamic(() => import("./editor-impl"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[60vh] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
      Loading sketch editor…
    </div>
  ),
});

export function SketchEditor(props: {
  sketchId: string;
  initialScene: SketchScene;
  canEdit: boolean;
}) {
  return <SketchEditorImpl {...props} />;
}
