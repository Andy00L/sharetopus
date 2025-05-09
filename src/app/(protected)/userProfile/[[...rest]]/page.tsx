import { SidebarContent } from "@/components/ui/sidebar";
import { UserProfile } from "@clerk/nextjs";

export default function AccountPage() {
  return (
    <SidebarContent className="mx-auto mt-10">
      <UserProfile />
    </SidebarContent>
  );
}
