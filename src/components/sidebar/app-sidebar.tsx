"use client";

import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { ArrowUpCircleIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { NavAccounts } from "./nav-accounts";
import { NavCreate } from "./nav-create";
import NavPost from "./nav-post";
import { NavUser } from "./nav-user";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <Link href="/">
                <ArrowUpCircleIcon className="h-5 w-5" />
                <span className="text-base font-semibold">CardScouts</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      {/**Search form*/}

      {/* Section Create */}
      <NavCreate />

      {/* Section Posts */}
      <NavPost />

      <SidebarSeparator />

      {/* Section Accounts */}
      <NavAccounts />

      <SidebarSeparator />

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
