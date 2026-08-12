"use client";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { usePathname } from "next/navigation";

import { ModeToggle } from "./ModeToggle";

export function SiteHeader() {
  const pathname = usePathname();

  // Maps the first URL segment to a readable page name.
  const getPageName = (path: string) => {
    if (path === "/") return "Home";

    const segments = path.slice(1).split("/");

    const pageNames: Record<string, string> = {
      create: "Create",
      studio: "Studio",
      connections: "Accounts",
      userProfile: "User Profile",
      scheduled: "Scheduled",
      posted: "Posted",
    };

    // Use the custom name when one exists, otherwise capitalize the segment.
    return (
      pageNames[segments[0]] ||
      segments[0].charAt(0).toUpperCase() + segments[0].slice(1)
    );
  };

  const pageName = getPageName(pathname);
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
          <h1 className="text-lg sm:text-base font-medium">{pageName}</h1>
        </div>

        <ModeToggle />
      </div>
    </header>
  );
}
