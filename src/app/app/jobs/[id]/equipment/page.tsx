import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function EquipmentTabPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Equipment placement</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Per-job equipment placement and daily-count logging arrive in Phase 5.
        </p>
      </CardContent>
    </Card>
  );
}
