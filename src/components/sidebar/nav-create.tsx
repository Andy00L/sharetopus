"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { LayoutDashboard, PlusCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavCreate() {
  const pathname = usePathname();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Create</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className={
                pathname.startsWith("/create") ? "bg-[#FF4A20] text-white" : ""
              }
            >
              <Link href="/create">
                <PlusCircle className="h-4 w-4" />
                <span>New Post</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className={
                pathname === "/studio" ? "bg-[#FF4A20] text-white" : ""
              }
            >
              <Link href="/studio">
                <LayoutDashboard className="h-4 w-4" />
                <span>Studio</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
