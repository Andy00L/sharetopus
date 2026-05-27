"use client";

import { getReferralProgress } from "@/actions/server/referral/getReferralProgress";
import { Gift } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";

/**
 * Sidebar entry for the referral program. Shows a "Refer & Earn" link
 * with a progress badge (e.g. "2/3") toward the next free week.
 *
 * Mirrors the structure of NavAccounts. Renders at the bottom of the
 * sidebar, before the footer.
 *
 * If the progress fetch fails, the badge is hidden (graceful degradation).
 */
export function NavReferral() {
  const pathname = usePathname();
  const { user } = useUser();
  const [badge, setBadge] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    getReferralProgress(user.id).then((result) => {
      if (result.success && !result.capReached) {
        setBadge(`${result.towardNextWeek}/3`);
      }
    });
  }, [user?.id]);

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
