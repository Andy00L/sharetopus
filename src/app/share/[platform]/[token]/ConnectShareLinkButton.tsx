"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

/**
 * Client component wrapping a form POST to the share link initiate route.
 *
 * Provides loading state to prevent double-clicks. The form POST triggers
 * a 302 redirect to TikTok (or to an error page on failure), so the browser
 * handles navigation natively.
 *
 * Called by: ShareLinkLandingPage
 */
export function ConnectShareLinkButton({
  initiateUrl,
}: {
  initiateUrl: string;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <form
      method="POST"
      action={initiateUrl}
      onSubmit={() => setIsSubmitting(true)}
    >
      <Button
        type="submit"
        disabled={isSubmitting}
        className="text-white"
        style={{ backgroundColor: "#FF4A20" }}
      >
        {isSubmitting ? "Connecting..." : "Connect TikTok Account"}
      </Button>
    </form>
  );
}
