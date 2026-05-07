import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function FormsTabPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Forms &amp; signatures</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          AOB / COC sending and e-signature flows arrive in Phase 7.
        </p>
      </CardContent>
    </Card>
  );
}
