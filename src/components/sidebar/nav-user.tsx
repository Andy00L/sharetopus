"use client";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { UserButton, useUser } from "@clerk/nextjs";

export function NavUser() {
  const { user, isLoaded, isSignedIn } = useUser();

  // Show loading state when authentication is being processed
  if (!isLoaded) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="animate-pulse" disabled>
            <div className="h-8 w-8 rounded-lg bg-muted"></div>
            <div className="grid flex-1 text-left text-sm leading-tight ml-2">
              <div className="h-4 w-24 bg-muted rounded"></div>
              <div className="h-3 w-32 bg-muted rounded mt-1"></div>
            </div>
            <div className="ml-auto h-4 w-4 rounded-full bg-muted"></div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }
  // Only show component when user is logged in
  if (!isSignedIn) {
    return null;
  }

  // Get user data from Clerk
  const userData = {
    name: user?.fullName ?? "Credit Savvy",
    email: user?.primaryEmailAddress?.emailAddress ?? "",
    avatar: user?.imageUrl ?? "",
    initials: user?.fullName
      ? user.fullName
          .split(" ")
          .map((name) => name[0])
          .join("")
          .substring(0, 2)
          .toUpperCase()
      : "US",
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <div className="h-8 w-8">
            <UserButton />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight ml-2">
            <span className="truncate font-medium">{userData.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {userData.email}
            </span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
