import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DEFAULT_AOB_BODY,
  DEFAULT_AOB_FIELDS,
  DEFAULT_COC_BODY,
  DEFAULT_COC_FIELDS,
} from "@/lib/forms/templates";
import { CreateTemplateForm } from "./create-template-form";
import { TemplateRow } from "./template-row";

export const dynamic = "force-dynamic";

export default async function AdminFormsPage() {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");
  if (!can(actor, "user.manage", { id: actor.organizationId })) {
    redirect("/app");
  }

  const templates = await prisma.formTemplate.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Form templates</h1>
        <p className="text-sm text-muted-foreground">
          Edit the schema (which fields render) and the Handlebars body
          (rendered into the signing page and the PDF).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Templates ({templates.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-0">
          {templates.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No templates yet. Create one below — copy the AOB or COC defaults
              to start from a working baseline.
            </p>
          ) : (
            <ul className="divide-y">
              {templates.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={{
                    id: t.id,
                    name: t.name,
                    schema: JSON.stringify(t.schema, null, 2),
                    bodyTemplate: t.bodyTemplate,
                    active: t.active,
                  }}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">New template</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateTemplateForm
            sampleAobSchema={JSON.stringify(
              { fields: DEFAULT_AOB_FIELDS },
              null,
              2,
            )}
            sampleAobBody={DEFAULT_AOB_BODY}
            sampleCocSchema={JSON.stringify(
              { fields: DEFAULT_COC_FIELDS },
              null,
              2,
            )}
            sampleCocBody={DEFAULT_COC_BODY}
          />
        </CardContent>
      </Card>
    </>
  );
}
