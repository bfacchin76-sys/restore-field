import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");
  if (!can(actor, "org.settings", { id: actor.organizationId })) {
    redirect("/app");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Import historical jobs (Encircle CSV)
        </h1>
        <p className="text-sm text-muted-foreground">
          One-time migration helper — Owner only. Each row becomes a customer
          (deduped by last name + address) and a closed historical job.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Upload CSV</CardTitle>
          <CardDescription>
            Imported jobs land in <strong>CLOSED</strong> status with the loss
            date as their close date. They&apos;re visible everywhere in the
            app like any other job.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImportForm />
        </CardContent>
      </Card>
    </div>
  );
}
