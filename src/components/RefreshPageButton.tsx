"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

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
