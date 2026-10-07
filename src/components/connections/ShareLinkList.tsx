"use client";

import { useState } from "react";
import type { ShareLinkSummary } from "@/actions/server/share-link/listShareLinks";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { RevokeShareLinkButton } from "./RevokeShareLinkButton";
import { toast } from "sonner";

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs < 0) return "Expired";

  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

function formatCreatedAt(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The user's active share links with copy and revoke actions. The connections page loads them
 * on the server (null when that failed); CreateShareLinkDialog refreshes the page after a create,
 * so a new link shows without a reload.
 */
export function ShareLinkList({ links }: { links: ShareLinkSummary[] | null }) {
  const [revokedLinkIds, setRevokedLinkIds] = useState<ReadonlySet<string>>(new Set());
  const visibleLinks = (links ?? []).filter((link) => !revokedLinkIds.has(link.id));

  function handleCopyLink(token: string) {
    const url = `${window.location.origin}/share/tiktok/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  }

  function handleRevoked(linkId: string) {
    setRevokedLinkIds((previousIds) => new Set(previousIds).add(linkId));
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <h3 className="text-sm font-semibold">Active share links</h3>
      </CardHeader>
      <CardContent>
        {links === null ? (
          <p className="text-sm text-destructive">
            Could not load your share links. Reload the page to try again.
          </p>
        ) : visibleLinks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active share links. Create one to let a friend connect their
            TikTok to your Sharetopus.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Created</TableHead>
                <TableHead className="text-xs">Expires</TableHead>
                <TableHead className="text-xs">Uses</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleLinks.map((link) => (
                <TableRow key={link.id}>
                  <TableCell className="text-xs">
                    {formatCreatedAt(link.createdAt)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {link.expiresAt
                      ? formatRelativeTime(link.expiresAt)
                      : "Never"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {link.usedCount}
                    {link.maxUses !== null ? ` / ${link.maxUses}` : ""}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => handleCopyLink(link.token)}
                    >
                      Copy
                    </Button>
                    <RevokeShareLinkButton
                      shareLinkId={link.id}
                      onRevoked={() => handleRevoked(link.id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
