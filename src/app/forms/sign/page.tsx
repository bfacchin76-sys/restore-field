import Link from "next/link";
import { FormStatus } from "@prisma/client";
import { findUsableToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db";
import { formSchemaSchema, formValuesSchema, renderTemplate } from "@/lib/forms/templates";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SignForm } from "./sign-form";

export const dynamic = "force-dynamic";

export default async function SignFormPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) return invalid("This signing link is missing a token.");

  const row = await findUsableToken(token, "FORM_SIGN");
  if (!row) return invalid("This signing link is invalid or has expired.");

  const payload = (row.payload ?? {}) as { submissionId?: string };
  if (!payload.submissionId) return invalid("This signing link is malformed.");

  const submission = await prisma.formSubmission.findUnique({
    where: { id: payload.submissionId },
    include: {
      template: true,
      job: {
        include: {
          customer: true,
          organization: { select: { name: true, primaryColor: true, reportFooter: true } },
        },
      },
    },
  });
  if (!submission) return invalid("Submission not found.");
  if (submission.status === FormStatus.COMPLETED) {
    return (
      <Wrapper title="Already signed">
        <Alert variant="success">
          <AlertDescription>
            This form was already signed and saved with the contractor.
            If you need a copy, contact{" "}
            <strong>{submission.job.organization.name}</strong>.
          </AlertDescription>
        </Alert>
      </Wrapper>
    );
  }

  const schemaParse = formSchemaSchema.safeParse(submission.template.schema);
  if (!schemaParse.success) return invalid("Template is corrupt — contact the sender.");
  const schema = schemaParse.data;

  const valuesParse = formValuesSchema.safeParse(submission.values);
  const initialValues = valuesParse.success ? valuesParse.data : {};

  const renderedBody = renderTemplate(submission.template.bodyTemplate, {
    job: {
      jobNumber: submission.job.jobNumber,
      lossDate: submission.job.lossDate ?? null,
      causeOfLoss: submission.job.causeOfLoss,
      scopeNotes: submission.job.scopeNotes,
    },
    customer: submission.job.customer,
    org: submission.job.organization,
    values: initialValues,
  });

  return (
    <Wrapper title={submission.template.name} subtitle={submission.job.organization.name}>
      <article
        className="prose prose-slate max-w-none rounded-md border bg-white p-6 text-sm"
        // The renderer escapes interpolated values; the template HTML itself
        // is admin-authored.
        dangerouslySetInnerHTML={{ __html: renderedBody }}
      />
      <SignForm
        token={token}
        schema={schema}
        initialValues={initialValues}
        recipientEmail={submission.sentToEmail ?? row.email}
      />
    </Wrapper>
  );
}

function Wrapper({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 bg-muted/30 px-4 py-10">
      <Card>
        <CardHeader>
          {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        <Link href="/" className="hover:underline">
          ← Back to RestoreField
        </Link>
      </p>
    </main>
  );
}

function invalid(message: string) {
  return (
    <Wrapper title="Sign-in link unavailable">
      <Alert variant="destructive">
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </Wrapper>
  );
}
