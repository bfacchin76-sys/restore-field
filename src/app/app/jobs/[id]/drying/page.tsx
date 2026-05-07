import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function DryingTabPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Drying log</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Daily psychrometric log and GPP calculator arrive in Phase 4.
        </p>
      </CardContent>
    </Card>
  );
}
