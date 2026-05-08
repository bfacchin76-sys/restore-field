import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { searchAcross, type SearchHit } from "@/lib/search/search";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  job: "Job",
  customer: "Customer",
  photo: "Photo",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();

  const hits = q.length > 0
    ? await searchAcross({ organizationId: actor.organizationId, query: q })
    : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">
          Across jobs, customers, and photo captions for your organisation.
        </p>
      </div>

      <form method="get" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          autoFocus
          placeholder="Job number, name, claim, caption…"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Search
        </button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Results {q ? `for "${q}"` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {q.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Enter a search term to begin.
            </p>
          ) : hits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matches.</p>
          ) : (
            <ul className="divide-y">
              {hits.map((h) => (
                <li key={`${h.kind}-${h.id}`} className="py-2">
                  <Link
                    href={h.href}
                    className="block hover:bg-accent rounded px-2 py-1 -mx-2"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs uppercase text-muted-foreground">
                        {KIND_LABEL[h.kind]}
                      </span>
                      <span className="font-medium">{h.title}</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {h.subtitle}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
