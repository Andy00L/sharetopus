"use client";

import { Gift } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";

export function NavReferralLink({ badge }: { badge: string | null }) {
  const pathname = usePathname();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className={
                pathname === "/referral" ? "bg-[#FF4A20] text-white" : ""
              }
            >
              <Link href="/referral">
                <Gift className="h-4 w-4" />
                <span>Refer & Earn</span>
                {badge && (
                  <span className="ml-auto text-xs font-medium opacity-70">
                    {badge}
                  </span>
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
