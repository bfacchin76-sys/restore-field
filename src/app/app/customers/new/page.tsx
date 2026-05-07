import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomerForm } from "../customer-form";

export default async function NewCustomerPage() {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New customer</h1>
        <p className="text-sm text-muted-foreground">
          Create the property contact, then start a job for them.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Customer details</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerForm />
        </CardContent>
      </Card>
    </>
  );
}
