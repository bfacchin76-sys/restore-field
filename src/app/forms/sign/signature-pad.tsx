"use client";

import { useEffect, useRef } from "react";
import SignaturePadLib from "react-signature-canvas";
import { Button } from "@/components/ui/button";

interface Props {
  value: string;
  onChange: (dataUrl: string) => void;
}

/**
 * Wraps react-signature-canvas with a stable Tailwind-styled frame and
 * a Clear button. Captures both touch and mouse — works on phones and
 * tablets out of the box.
 */
export default function SignaturePad({ value, onChange }: Props) {
  const padRef = useRef<SignaturePadLib | null>(null);

  // Hydrate the pad with an existing data URL on mount (in case the
  // form was partially completed previously).
  useEffect(() => {
    if (value && padRef.current && padRef.current.isEmpty()) {
      try {
        padRef.current.fromDataURL(value);
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-input bg-white">
        <SignaturePadLib
          ref={padRef}
          canvasProps={{
            className: "w-full h-40 rounded-md",
            // Honour devicePixelRatio for crisper strokes on retina screens.
            // react-signature-canvas reads DPR internally too.
          }}
          onEnd={() => {
            const pad = padRef.current;
            if (!pad) return;
            const data = pad.isEmpty()
              ? ""
              : pad.toDataURL("image/png");
            onChange(data);
          }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Sign with finger or mouse. Pinch / drag is fine.</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            padRef.current?.clear();
            onChange("");
          }}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
