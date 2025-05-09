"use client";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { usePathname } from "next/navigation";

export function SiteHeader() {
  const pathname = usePathname();

  // Fonction pour obtenir le nom de la page à partir du chemin URL
  const getPageName = (path: string) => {
    // Si c'est la page d'accueil
    if (path === "/") return "Accueil";

    // Supprime le slash au début et divise par les slashs
    const segments = path.slice(1).split("/");

    // Correspondance des chemins avec des noms plus lisibles
    const pageNames: Record<string, string> = {
      create: "Create",
      studio: "Studio",
      connections: "Accounts",
      userProfile: "User Profile",
      scheduled: "Scheduled",
      posted: "Posted",
    };

    // Utilise le nom personnalisé s'il existe, sinon met en majuscule le segment
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

        {/**<ModeToggle />*/}
      </div>
    </header>
  );
}
