import Link from "next/link";
import { redirect } from "next/navigation";
import { LossType } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NewJobForm } from "./new-job-form";

export const dynamic = "force-dynamic";

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");
  if (!can(actor, "job.create", { id: actor.organizationId })) {
    redirect("/app/jobs");
  }

  const { customerId } = await searchParams;
  const customers = await prisma.customer.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 500,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      addressLine1: true,
      city: true,
    },
  });

  if (customers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Create a customer first</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            A job needs a customer record. Create one and come back.
          </p>
          <Link
            href="/app/customers/new"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            New customer
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New job</h1>
        <p className="text-sm text-muted-foreground">
          Choose a customer and the loss type. The job number is generated
          automatically.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Job details</CardTitle>
        </CardHeader>
        <CardContent>
          <NewJobForm
            customers={customers}
            initialCustomerId={customerId}
            lossTypes={Object.values(LossType)}
          />
        </CardContent>
      </Card>
    </>
  );
}
