import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function ReportsTabPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Reports</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Carrier-ready PDF generation arrives in Phase 9.
        </p>
      </CardContent>
    </Card>
  );
}
