import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function MoistureTabPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Moisture readings</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Reading entry, time-series chart, and dry-goal tracking arrive in
          Phase 4.
        </p>
      </CardContent>
    </Card>
  );
}
