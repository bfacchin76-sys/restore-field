import { notFound, redirect } from "next/navigation";
import type { Salvageability } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import { getStorage } from "@/lib/storage";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PhotoGrid } from "./photo-grid";
import { PhotoUploader } from "./photo-uploader";
import { AutoClassifyButton } from "./auto-classify-button";

export const dynamic = "force-dynamic";

interface PhotosPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ room?: string; salvage?: string }>;
}

export default async function PhotosTabPage({
  params,
  searchParams,
}: PhotosPageProps) {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");

  const { id } = await params;
  const sp = await searchParams;

  const job = await prisma.job.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      lossType: true,
      createdById: true,
      assignments: { select: { userId: true } },
      rooms: {
        orderBy: [{ sortOrder: "asc" }],
        select: { id: true, name: true },
      },
    },
  });
  if (!job || job.organizationId !== actor.organizationId) notFound();

  const canEdit = can(actor, "photo.upload", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const roomFilter = sp.room === "unassigned" ? "unassigned" : sp.room;
  const salvageFilter = (sp.salvage as Salvageability | undefined) ?? undefined;

  const photos = await prisma.photo.findMany({
    where: {
      jobId: id,
      ...(roomFilter === "unassigned"
        ? { roomId: null }
        : roomFilter
          ? { roomId: roomFilter }
          : {}),
      ...(salvageFilter ? { salvageability: salvageFilter } : {}),
    },
    orderBy: [{ takenAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });

  // Resolve presigned read URLs server-side. Short-lived (15 min). Page is
  // dynamic so URLs are minted per request.
  const storage = getStorage();
  const photosWithUrls = await Promise.all(
    photos.map(async (p) => {
      const thumb = p.thumbnailKey
        ? await storage.presignedGet({ key: p.thumbnailKey })
        : null;
      const medium = p.mediumKey
        ? await storage.presignedGet({ key: p.mediumKey })
        : null;
      const original = p.storageKey
        ? await storage.presignedGet({ key: p.storageKey })
        : null;
      return {
        id: p.id,
        roomId: p.roomId,
        caption: p.caption,
        tags: p.tags,
        salvageability: p.salvageability,
        width: p.width,
        height: p.height,
        takenAt: p.takenAt?.toISOString() ?? null,
        gpsLat: p.gpsLat,
        gpsLng: p.gpsLng,
        processedAt: p.processedAt?.toISOString() ?? null,
        processingError: p.processingError,
        thumbUrl: thumb?.url ?? null,
        mediumUrl: medium?.url ?? null,
        originalUrl: original?.url ?? null,
      };
    }),
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg">
              Photos ({photos.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {job.rooms.length === 0
                ? "Add rooms on the Rooms tab to organise photos by location."
                : `${job.rooms.length} rooms available for tagging.`}
            </p>
          </div>
          {canEdit && job.lossType === "FIRE" ? (
            <AutoClassifyButton jobId={job.id} />
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {canEdit ? (
            <PhotoUploader jobId={job.id} rooms={job.rooms} />
          ) : (
            <p className="text-sm text-muted-foreground">
              You don&apos;t have permission to upload photos to this job.
            </p>
          )}

          <PhotoFilters
            jobId={job.id}
            rooms={job.rooms}
            roomFilter={roomFilter ?? null}
            salvageFilter={salvageFilter ?? null}
          />

          <PhotoGrid
            jobId={job.id}
            rooms={job.rooms}
            photos={photosWithUrls}
            canEdit={canEdit}
            isFireJob={job.lossType === "FIRE"}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function PhotoFilters({
  jobId,
  rooms,
  roomFilter,
  salvageFilter,
}: {
  jobId: string;
  rooms: Array<{ id: string; name: string }>;
  roomFilter: string | null;
  salvageFilter: Salvageability | null;
}) {
  const linkFor = (
    overrides: Partial<{ room: string | null; salvage: Salvageability | null }>,
  ) => {
    const u = new URLSearchParams();
    const room = overrides.room ?? (overrides.room === null ? null : roomFilter);
    const salvage =
      overrides.salvage ?? (overrides.salvage === null ? null : salvageFilter);
    if (room) u.set("room", room);
    if (salvage) u.set("salvage", salvage);
    const qs = u.toString();
    return qs
      ? `/app/jobs/${jobId}/photos?${qs}`
      : `/app/jobs/${jobId}/photos`;
  };

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-[11px] ${
      active
        ? "border-primary bg-primary/10 text-primary"
        : "border-border text-muted-foreground hover:bg-accent"
    }`;

  const salvageOptions: { label: string; value: Salvageability }[] = [
    { label: "salvageable", value: "SALVAGEABLE" },
    { label: "unsalvageable", value: "UNSALVAGEABLE" },
    { label: "needs cleaning", value: "REQUIRES_PROFESSIONAL_CLEANING" },
    { label: "pending", value: "PENDING_REVIEW" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium uppercase text-muted-foreground">Room:</span>
      <a href={linkFor({ room: null })} className={chip(roomFilter === null)}>
        all
      </a>
      <a
        href={linkFor({ room: "unassigned" })}
        className={chip(roomFilter === "unassigned")}
      >
        unassigned
      </a>
      {rooms.map((r) => (
        <a
          key={r.id}
          href={linkFor({ room: r.id })}
          className={chip(roomFilter === r.id)}
        >
          {r.name}
        </a>
      ))}

      {rooms.length > 0 ? <span className="mx-1 text-muted-foreground">·</span> : null}

      <span className="ml-2 font-medium uppercase text-muted-foreground">
        Salvageability:
      </span>
      <a href={linkFor({ salvage: null })} className={chip(salvageFilter === null)}>
        all
      </a>
      {salvageOptions.map((opt) => (
        <a
          key={opt.value}
          href={linkFor({ salvage: opt.value })}
          className={chip(salvageFilter === opt.value)}
        >
          {opt.label}
        </a>
      ))}
    </div>
  );
}
