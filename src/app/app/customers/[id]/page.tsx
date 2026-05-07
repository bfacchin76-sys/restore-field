import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CustomerForm } from "../customer-form";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");

  const { id } = await params;
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      jobs: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          jobNumber: true,
          status: true,
          lossType: true,
          createdAt: true,
        },
      },
    },
  });

  if (!customer || customer.organizationId !== actor.organizationId) {
    notFound();
  }

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/app/customers" className="hover:underline">
              ← All customers
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {customer.firstName} {customer.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {customer.addressLine1}
            {customer.addressLine2 ? `, ${customer.addressLine2}` : ""},{" "}
            {customer.city}, {customer.state} {customer.postalCode}
          </p>
        </div>
        <Link
          href={`/app/jobs/new?customerId=${customer.id}`}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          New job for this customer
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Jobs</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {customer.jobs.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No jobs yet for this customer.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-6 py-3">Job number</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Loss type</th>
                  <th className="px-6 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {customer.jobs.map((j) => (
                  <tr key={j.id} className="border-b last:border-b-0">
                    <td className="px-6 py-3 font-mono text-xs">
                      <Link
                        href={`/app/jobs/${j.id}`}
                        className="hover:underline"
                      >
                        {j.jobNumber}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-xs uppercase">
                      {j.status.replace("_", " ").toLowerCase()}
                    </td>
                    <td className="px-6 py-3 text-xs uppercase">
                      {j.lossType.toLowerCase()}
                    </td>
                    <td className="px-6 py-3 text-xs text-muted-foreground">
                      {j.createdAt.toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Customer details</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerForm customer={customer} />
        </CardContent>
      </Card>
    </>
  );
}
