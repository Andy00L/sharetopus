import { CheckCircle, Clock } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";

export default function NavPost() {
  const pathname = usePathname();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Posts</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem></SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className={
                pathname === "/scheduled" ? "bg-[#FF4A20] text-white" : ""
              }
            >
              <Link href="/scheduled">
                <Clock className="h-4 w-4" />
                <span>Scheduled</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className={
                pathname === "/posted" ? "bg-[#FF4A20] text-white" : ""
              }
            >
              <Link href="/posted">
                <CheckCircle className="h-4 w-4" />
                <span>Posted</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
