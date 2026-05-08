import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StuckItemsClient } from "./stuck-items-client";

export const dynamic = "force-dynamic";

export default async function SyncStatusPage() {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sync status</h1>
        <p className="text-sm text-muted-foreground">
          Items captured offline are queued in this browser&apos;s IndexedDB
          and replayed when the network returns. Items that fail to sync for
          24 h surface here for manual review.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Local queue</CardTitle>
          <CardDescription>
            Photos store the original blob; readings and notes are JSON.
            Refresh the page or reconnect to trigger a sync.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StuckItemsClient />
        </CardContent>
      </Card>
    </>
  );
}
