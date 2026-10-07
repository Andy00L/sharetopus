"use client";

import { useState } from "react";
import { revokeShareLink } from "@/actions/server/share-link/revokeShareLink";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

/**
 * Revoke with an AlertDialog confirmation; the row hides once the server confirms, so a failed
 * revoke never hides a link that still works. Accounts already connected through it stay.
 */
export function RevokeShareLinkButton({
  shareLinkId,
  onRevoked,
}: {
  shareLinkId: string;
  onRevoked: () => void;
}) {
  const [isRevoking, setIsRevoking] = useState(false);

  async function handleRevoke() {
    setIsRevoking(true);
    const result = await revokeShareLink({ shareLinkId });

    if (result.success) {
      onRevoked();
      toast.success("Share link revoked");
    } else {
      toast.error(result.message);
    }
    setIsRevoking(false);
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" className="text-xs" disabled={isRevoking}>
          {isRevoking ? "Revoking..." : "Revoke"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke share link?</AlertDialogTitle>
          <AlertDialogDescription>
            This will prevent anyone from using this link in the future. Accounts
            that have already been connected will not be disconnected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleRevoke}>
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
