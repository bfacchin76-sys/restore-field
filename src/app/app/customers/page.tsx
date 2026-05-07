import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");

  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const customers = await prisma.customer.findMany({
    where: {
      organizationId: actor.organizationId,
      ...(query
        ? {
            OR: [
              { firstName: { contains: query, mode: "insensitive" } },
              { lastName: { contains: query, mode: "insensitive" } },
              { addressLine1: { contains: query, mode: "insensitive" } },
              { city: { contains: query, mode: "insensitive" } },
              { claimNumber: { contains: query, mode: "insensitive" } },
              { policyNumber: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 200,
    include: { _count: { select: { jobs: true } } },
  });

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">
            People and properties on file. {customers.length} shown.
          </p>
        </div>
        <Link
          href="/app/customers/new"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          New customer
        </Link>
      </div>

      <Card>
        <CardContent className="p-4">
          <form action="/app/customers" method="get" className="flex gap-2">
            <Input
              name="q"
              defaultValue={query}
              placeholder="Search by name, address, claim # …"
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
            {query ? (
              <Link
                href="/app/customers"
                className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-3 text-sm hover:bg-accent"
              >
                Clear
              </Link>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Customer list</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Address</th>
                <th className="px-6 py-3">Claim #</th>
                <th className="px-6 py-3">Jobs</th>
                <th className="px-6 py-3 text-right" />
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                    {query
                      ? "No matching customers."
                      : "No customers yet. Create one to get started."}
                  </td>
                </tr>
              ) : (
                customers.map((c) => (
                  <tr key={c.id} className="border-b last:border-b-0">
                    <td className="px-6 py-3 font-medium">
                      <Link
                        href={`/app/customers/${c.id}`}
                        className="hover:underline"
                      >
                        {c.firstName} {c.lastName}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {c.addressLine1}, {c.city} {c.state}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {c.claimNumber ?? "—"}
                    </td>
                    <td className="px-6 py-3">{c._count.jobs}</td>
                    <td className="px-6 py-3 text-right">
                      <Link
                        href={`/app/customers/${c.id}`}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
