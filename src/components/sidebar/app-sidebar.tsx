"use client";

import avatar from "../../../public/trans_logo (1).webp";
import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import Link from "next/link";
import * as React from "react";
import { NavAccounts } from "./nav-accounts";
import { NavCreate } from "./nav-create";
import NavPost from "./nav-post";
import { NavUser } from "./nav-user";
import Image from "next/image";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      {/**Side bar header*/}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <Link href="/create">
                <Image
                  src={avatar}
                  alt="Sharetopus logo"
                  height={42}
                  width={42}
                  className="object-cover"
                />
                <span className="text-base font-semibold">Sharetopus</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Section Create */}
      <NavCreate />

      {/* Section Posts */}
      <NavPost />

      <SidebarSeparator />

      {/* Section Accounts */}
      <NavAccounts />

      <SidebarFooter className="mt-auto">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
