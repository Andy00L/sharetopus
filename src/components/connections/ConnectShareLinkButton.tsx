"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

/** Posts to the share link initiate route, which redirects to TikTok; disabled after the first click. */
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
