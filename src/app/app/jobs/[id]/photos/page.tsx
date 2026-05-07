import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function PhotosTabPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Photos</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Photo capture, upload, and gallery arrive in Phase 3.
        </p>
      </CardContent>
    </Card>
  );
}
