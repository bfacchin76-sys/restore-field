"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { extendShare, revokeShare } from "./actions";

interface Props {
  shareId: string;
  token: string;
  recipientEmail: string;
  expiresAt: string;
  revoked: boolean;
  lastUsedAt: string | null;
  scopesSummary: string;
  shareBaseUrl: string;
  canManage: boolean;
}

export function ShareRow({
  shareId,
  token,
  recipientEmail,
  expiresAt,
  revoked,
  lastUsedAt,
  scopesSummary,
  shareBaseUrl,
  canManage,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Re-evaluated on each render is intentional — the badge updates as
  // the link crosses its expiry on a long-lived page.
  // eslint-disable-next-line react-hooks/purity
  const expired = new Date(expiresAt).getTime() < Date.now();
  const dead = revoked || expired;
  const url = `${shareBaseUrl}/${token}`;

  const onRevoke = () => {
    if (!confirm("Revoke this share link?")) return;
    startTransition(async () => {
      await revokeShare({ shareId });
      router.refresh();
    });
  };

  const onExtend = () => {
    startTransition(async () => {
      await extendShare({ shareId, extraDays: 7 });
      router.refresh();
    });
  };

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{recipientEmail}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {scopesSummary}
          </div>
          <div className="mt-1 text-xs">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="break-all text-blue-600 underline"
            >
              {url}
            </a>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {revoked ? (
              <span className="text-red-700">Revoked</span>
            ) : expired ? (
              <span className="text-yellow-700">
                Expired {new Date(expiresAt).toLocaleDateString("en-US")}
              </span>
            ) : (
              <>Expires {new Date(expiresAt).toLocaleString("en-US")}</>
            )}
            {lastUsedAt
              ? ` · Last opened ${new Date(lastUsedAt).toLocaleString("en-US")}`
              : " · Never opened"}
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onExtend}
              disabled={pending}
            >
              {dead ? "Re-issue (+7d)" : "Extend +7d"}
            </Button>
            {!revoked && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onRevoke}
                disabled={pending}
              >
                Revoke
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
