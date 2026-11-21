"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";

export default function ProtectedPageError({
  error,
  unstable_retry,
}: Readonly<{ error: Error & { digest?: string }; unstable_retry: () => void }>) {
  return (
    <SidebarContent>
      <div className="container px-4 py-6">
        <SidebarGroup>
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-destructive">
            <div className="flex items-start gap-3">
              <RefreshCw className="h-5 w-5 mt-0.5" />
              <div>
                <h3 className="font-medium mb-1">This page could not load</h3>
                <p className="text-sm">
                  Try again, or come back in a minute.
                </p>
                {error.digest && (
                  <p className="text-xs mt-1 break-all">
                    Reference: {error.digest}
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => unstable_retry()}
                >
                  Try again
                </Button>
              </div>
            </div>
          </div>
        </SidebarGroup>
      </div>
    </SidebarContent>
  );
}
