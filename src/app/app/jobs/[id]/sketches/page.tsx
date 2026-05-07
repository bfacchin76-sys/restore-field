import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function SketchesTabPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Sketches</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Konva-based floor-plan sketcher and Xactimate-underlay export arrive
          in Phase 6.
        </p>
      </CardContent>
    </Card>
  );
}
