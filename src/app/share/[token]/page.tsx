import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

interface SharePermissions {
  /** "report" exposes a single rendered Report PDF. "job" exposes a
   *  scoped, in-page job summary. */
  kind?: "report" | "job";
  reportId?: string;
  scopes?: {
    photos?: boolean;
    readings?: boolean;
    dryingLogs?: boolean;
    equipment?: boolean;
    reportIds?: string[];
  };
  message?: string;
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const share = await prisma.jobShare.findUnique({
    where: { token },
    include: {
      job: {
        include: {
          customer: true,
          organization: {
            select: {
              name: true,
              primaryColor: true,
              reportFooter: true,
              licenseNumber: true,
              logoUrl: true,
            },
          },
        },
      },
    },
  });
  if (!share) notFound();

  // RSC renders once per request — wall-clock comparison is the
  // intended semantic for "is this share still valid right now".
  // eslint-disable-next-line react-hooks/purity
  const expired = share.expiresAt.getTime() < Date.now();
  const dead = share.revoked || expired;

  if (dead) {
    return (
      <ShareLayout orgName={share.job.organization.name}>
        <ExpiredOrRevoked
          revoked={share.revoked}
          expiresAt={share.expiresAt}
        />
      </ShareLayout>
    );
  }

  // Record the access (best-effort).
  await prisma.jobShare.update({
    where: { id: share.id },
    data: { lastUsedAt: new Date() },
  });
  await recordAudit(
    "share.view",
    { actor: null, jobId: share.jobId },
    { shareId: share.id, recipientEmail: share.recipientEmail },
  );

  const perms = (share.permissions ?? {}) as SharePermissions;
  const kind = perms.kind ?? (perms.reportId ? "report" : "job");

  if (kind === "report" && perms.reportId) {
    return (
      <ShareLayout
        orgName={share.job.organization.name}
        org={share.job.organization}
      >
        <ReportShareView
          token={token}
          reportId={perms.reportId}
          jobNumber={share.job.jobNumber}
          customerName={`${share.job.customer.firstName} ${share.job.customer.lastName}`}
          recipientEmail={share.recipientEmail}
          expiresAt={share.expiresAt}
          message={perms.message}
        />
      </ShareLayout>
    );
  }

  // Job-scope share.
  const scopes = perms.scopes ?? {};
  const job = share.job;

  const [photos, readings, dryingLogs, placements, reports] = await Promise.all(
    [
      scopes.photos
        ? prisma.photo.findMany({
            where: { jobId: job.id },
            include: { room: { select: { name: true } } },
            orderBy: { takenAt: "asc" },
            take: 200,
          })
        : Promise.resolve([]),
      scopes.readings
        ? prisma.moistureReading.findMany({
            where: { jobId: job.id },
            include: { room: { select: { name: true } } },
            orderBy: { takenAt: "asc" },
          })
        : Promise.resolve([]),
      scopes.dryingLogs
        ? prisma.dryingLog.findMany({
            where: { jobId: job.id },
            orderBy: { logDate: "asc" },
          })
        : Promise.resolve([]),
      scopes.equipment
        ? prisma.equipmentPlacement.findMany({
            where: { jobId: job.id },
            include: {
              equipment: { select: { assetTag: true, type: true } },
              room: { select: { name: true } },
            },
            orderBy: { placedAt: "asc" },
          })
        : Promise.resolve([]),
      scopes.reportIds && scopes.reportIds.length > 0
        ? prisma.report.findMany({
            where: { id: { in: scopes.reportIds }, jobId: job.id },
            select: {
              id: true,
              type: true,
              generatedAt: true,
              pdfStorageKey: true,
            },
          })
        : Promise.resolve([]),
    ],
  );

  return (
    <ShareLayout orgName={job.organization.name} org={job.organization}>
      <JobShareView
        token={token}
        job={{
          jobNumber: job.jobNumber,
          lossType: job.lossType,
          lossDate: job.lossDate,
          causeOfLoss: job.causeOfLoss,
          scopeNotes: job.scopeNotes,
        }}
        customer={job.customer}
        photos={photos}
        readings={readings}
        dryingLogs={dryingLogs}
        placements={placements}
        reports={reports}
        recipientEmail={share.recipientEmail}
        expiresAt={share.expiresAt}
        message={perms.message}
      />
    </ShareLayout>
  );
}

// =============================================================================
// Sub-views
// =============================================================================

function ShareLayout({
  orgName,
  org,
  children,
}: {
  orgName: string;
  org?: { primaryColor: string; licenseNumber: string | null; reportFooter: string | null };
  children: React.ReactNode;
}) {
  const color = org?.primaryColor ?? "#1e3a8a";
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header
        className="border-b text-white"
        style={{ backgroundColor: color }}
      >
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-4">
          <div className="text-lg font-semibold tracking-tight">{orgName}</div>
          {org?.licenseNumber && (
            <div className="text-xs opacity-80">License {org.licenseNumber}</div>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-6 py-8">{children}</main>
      <footer className="mx-auto mt-12 max-w-4xl px-6 pb-8 text-xs text-muted-foreground">
        {org?.reportFooter ? `${org.reportFooter} · ` : ""}This is a private,
        time-limited share link. Do not forward.
      </footer>
    </div>
  );
}

function ExpiredOrRevoked({
  revoked,
  expiresAt,
}: {
  revoked: boolean;
  expiresAt: Date;
}) {
  return (
    <div className="rounded-md border bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold">
        {revoked ? "Link revoked" : "Link expired"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {revoked
          ? "The sender revoked this share link."
          : `This link expired on ${expiresAt.toLocaleString("en-US")}.`}
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Contact the sender to request a new link.
      </p>
    </div>
  );
}

function ReportShareView({
  token,
  reportId,
  jobNumber,
  customerName,
  recipientEmail,
  expiresAt,
  message,
}: {
  token: string;
  reportId: string;
  jobNumber: string;
  customerName: string;
  recipientEmail: string;
  expiresAt: Date;
  message?: string;
}) {
  const pdfHref = `/share/${token}/pdf`;
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Restoration report</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Job {jobNumber} · {customerName}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Shared with {recipientEmail} · expires{" "}
          {expiresAt.toLocaleDateString("en-US")}
        </p>
        {message && (
          <div className="mt-4 rounded-md border-l-4 border-blue-500 bg-blue-50 p-3 text-sm">
            {message}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={pdfHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Open PDF
          </a>
          <a
            href={pdfHref}
            download={`${jobNumber}-${reportId}.pdf`}
            className="inline-flex items-center rounded-md border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Download
          </a>
        </div>
      </div>
      <div className="rounded-md border bg-white p-2 shadow-sm">
        <object
          data={pdfHref}
          type="application/pdf"
          className="h-[80vh] w-full"
        >
          <p className="p-4 text-sm text-muted-foreground">
            Your browser can&apos;t render the PDF inline.{" "}
            <a className="underline" href={pdfHref}>
              Open it directly.
            </a>
          </p>
        </object>
      </div>
    </div>
  );
}

function JobShareView({
  token,
  job,
  customer,
  photos,
  readings,
  dryingLogs,
  placements,
  reports,
  recipientEmail,
  expiresAt,
  message,
}: {
  token: string;
  job: {
    jobNumber: string;
    lossType: string;
    lossDate: Date | null;
    causeOfLoss: string | null;
    scopeNotes: string | null;
  };
  customer: {
    firstName: string;
    lastName: string;
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
  };
  photos: Array<{
    id: string;
    caption: string | null;
    takenAt: Date | null;
    mediumKey: string | null;
    storageKey: string;
    room: { name: string } | null;
  }>;
  readings: Array<{
    id: string;
    surface: string;
    moistureValue: number;
    scaleType: string;
    takenAt: Date;
    room: { name: string } | null;
  }>;
  dryingLogs: Array<{
    id: string;
    logDate: Date;
    affectedTempF: number | null;
    affectedRH: number | null;
    affectedGPP: number | null;
  }>;
  placements: Array<{
    id: string;
    placedAt: Date;
    removedAt: Date | null;
    equipment: { assetTag: string; type: string };
    room: { name: string } | null;
  }>;
  reports: Array<{
    id: string;
    type: string;
    generatedAt: Date;
    pdfStorageKey: string;
  }>;
  recipientEmail: string;
  expiresAt: Date;
  message?: string;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-md border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">
          {customer.firstName} {customer.lastName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Job {job.jobNumber} · {job.lossType.toLowerCase()} damage ·{" "}
          {customer.addressLine1}, {customer.city}, {customer.state}{" "}
          {customer.postalCode}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Shared with {recipientEmail} · expires{" "}
          {expiresAt.toLocaleDateString("en-US")}
        </p>
        {message && (
          <div className="mt-4 rounded-md border-l-4 border-blue-500 bg-blue-50 p-3 text-sm">
            {message}
          </div>
        )}
        {job.scopeNotes && (
          <p className="mt-3 text-sm">
            <strong>Scope:</strong> {job.scopeNotes}
          </p>
        )}
      </div>

      {reports.length > 0 && (
        <section className="rounded-md border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Reports</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {reports.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between border-b pb-2 last:border-b-0"
              >
                <div>
                  <div className="font-medium">{r.type}</div>
                  <div className="text-xs text-muted-foreground">
                    Generated {r.generatedAt.toLocaleString("en-US")}
                  </div>
                </div>
                {r.pdfStorageKey ? (
                  <a
                    href={`/share/${token}/report/${r.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 underline"
                  >
                    Open PDF
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Generating…
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {photos.length > 0 && (
        <section className="rounded-md border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Photos ({photos.length})</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((p) => (
              <a
                key={p.id}
                href={`/share/${token}/photo/${p.id}`}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-md border bg-slate-100"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/share/${token}/photo/${p.id}`}
                  alt={p.caption ?? "photo"}
                  className="aspect-square w-full object-cover"
                />
                {(p.room?.name || p.caption) && (
                  <div className="px-2 py-1 text-xs">
                    {p.room?.name && (
                      <div className="font-medium text-blue-700">
                        {p.room.name}
                      </div>
                    )}
                    {p.caption && (
                      <div className="text-slate-700">{p.caption}</div>
                    )}
                  </div>
                )}
              </a>
            ))}
          </div>
        </section>
      )}

      {readings.length > 0 && (
        <section className="rounded-md border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">
            Moisture readings ({readings.length})
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-1">When</th>
                  <th className="px-2 py-1">Room</th>
                  <th className="px-2 py-1">Surface</th>
                  <th className="px-2 py-1">Reading</th>
                </tr>
              </thead>
              <tbody>
                {readings.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-1">
                      {r.takenAt.toLocaleString("en-US")}
                    </td>
                    <td className="px-2 py-1">{r.room?.name ?? "—"}</td>
                    <td className="px-2 py-1">{r.surface}</td>
                    <td className="px-2 py-1 font-mono">
                      {r.moistureValue}
                      {r.scaleType.startsWith("PERCENT") ? "%" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {dryingLogs.length > 0 && (
        <section className="rounded-md border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">
            Drying log ({dryingLogs.length})
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-1">Date</th>
                  <th className="px-2 py-1">Affected °F</th>
                  <th className="px-2 py-1">RH</th>
                  <th className="px-2 py-1">GPP</th>
                </tr>
              </thead>
              <tbody>
                {dryingLogs.map((d) => (
                  <tr key={d.id} className="border-t">
                    <td className="px-2 py-1">
                      {d.logDate.toLocaleDateString("en-US")}
                    </td>
                    <td className="px-2 py-1">{d.affectedTempF ?? "—"}</td>
                    <td className="px-2 py-1">{d.affectedRH ?? "—"}</td>
                    <td className="px-2 py-1">{d.affectedGPP ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {placements.length > 0 && (
        <section className="rounded-md border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">
            Equipment ({placements.length})
          </h2>
          <ul className="mt-3 space-y-1 text-sm">
            {placements.map((p) => (
              <li key={p.id}>
                <strong>{p.equipment.assetTag}</strong> · {p.equipment.type}
                {p.room?.name && ` · ${p.room.name}`} ·{" "}
                {p.placedAt.toLocaleDateString("en-US")} →{" "}
                {p.removedAt
                  ? p.removedAt.toLocaleDateString("en-US")
                  : "still deployed"}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
