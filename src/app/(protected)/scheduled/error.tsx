// app/(protected)/scheduled/error.tsx
"use client";

import { Button } from "@/components/ui/button";
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";
import { RefreshCw } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

export default function ScheduledError({
  error,
  reset,
}: Readonly<{ error: Error; reset: () => void }>) {
  /* — log pour le débug — */
  useEffect(() => {
    console.error("Scheduled posts page crashed:", error);
  }, [error]);

  const [isPending, startTransition] = useTransition();
  const [minDelayActive, setMinDelayActive] = useState(false);

  const isLoading = isPending || minDelayActive;

  return (
    <SidebarContent>
      <div className="container px-4 py-6">
        <SidebarGroup>
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-destructive">
            <div className="flex items-start gap-3">
              <RefreshCw className="h-5 w-5 mt-0.5" />
              <div>
                <h3 className="font-medium mb-1">
                  Error loading scheduled posts
                </h3>
                <p className="text-sm break-all">{error.message}</p>

                {/* BOUTON RETRY */}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={isLoading}
                  onClick={() => {
                    /* 1 : on force au moins 1 s d’animation */
                    setMinDelayActive(true);

                    setTimeout(() => {
                      /* 2 : on re‑tente le rendu du segment */
                      startTransition(() => {
                        reset(); // <‑‑ la bonne API
                      });
                    }, 1000);
                  }}
                >
                  {isLoading && (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {isLoading ? "Retrying…" : "Try again"}
                </Button>
              </div>
            </div>
          </div>
        </SidebarGroup>
      </div>
    </SidebarContent>
  );
}
