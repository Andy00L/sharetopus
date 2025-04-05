import { ensureUserExists } from "@/actions/server/supabase/ensureUserExists";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SiteHeader } from "@/components/sidebar/Site-Header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { currentUser } from "@clerk/nextjs/server";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Récupérer les informations utilisateur depuis Clerk
  const user = await currentUser();

  // Si l'utilisateur est authentifié, synchroniser ses données dans Supabase
  if (user) {
    await ensureUserExists({
      userId: user.id,
      UserEmail: user.emailAddresses[0].emailAddress,
      fullName: user.fullName,
    });
  }
  return (
    <SidebarProvider>
      <AppSidebar variant="inset" />
      <SidebarInset>
        {/**ca C'EST CLIENT */}
        <SiteHeader />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
