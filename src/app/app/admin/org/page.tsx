import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OrgSettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function AdminOrgSettingsPage() {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");
  if (!can(actor, "org.settings", { id: actor.organizationId })) {
    redirect("/app");
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: actor.organizationId },
    select: {
      name: true,
      salesTaxRate: true,
      overheadProfitRate: true,
      licenseNumber: true,
      reportFooter: true,
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Organization settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Estimate defaults, license number, and report footer for{" "}
          <strong>{org.name}</strong>.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Estimate defaults &amp; branding</CardTitle>
        </CardHeader>
        <CardContent>
          <OrgSettingsForm
            initial={{
              salesTaxRate: org.salesTaxRate,
              overheadProfitRate: org.overheadProfitRate,
              licenseNumber: org.licenseNumber,
              reportFooter: org.reportFooter,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
