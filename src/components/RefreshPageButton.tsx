"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

/**
 * Re-renders the current page's server components (router.refresh). The URL
 * and its query stay as they are, so a schedule prefill survives the retry.
 * Disabled while the refresh runs.
 */
export function RefreshPageButton() {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();

  return (
    <Button
      type="button"
      className="h-11 cursor-pointer px-5"
      disabled={isRefreshing}
      onClick={() => startRefresh(() => router.refresh())}
    >
      {isRefreshing ? "Checking..." : "Try again"}
    </Button>
  );
}
