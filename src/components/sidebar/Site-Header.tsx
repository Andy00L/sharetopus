"use client";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ModeToggle } from "./ModeToggle";

export function SiteHeader() {
  return (
    <header className="group-has-data-[collapsible=icon]/sidebar-wrapper:h-14 sm:h-12 flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear">
      <div className="flex w-full items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-2 lg:gap-2">
          <SidebarTrigger
            size="lg"
            className="-ml-1 cursor-pointer h-8 w-8 sm:h-6 sm:w-6"
          />
          <Separator
            orientation="vertical"
            className="mx-2 data-[orientation=vertical]:h-4 "
          />
          <h1 className="text-lg sm:text-base font-medium">App</h1>
        </div>

        <ModeToggle />
      </div>
    </header>
  );
}
