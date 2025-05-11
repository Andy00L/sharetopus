"use client";

import { checkUserSubscription } from "@/actions/server/stripe/checkUserSubscription";
import { createCustomerPortalProtected } from "@/actions/server/stripe/customerPortal";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useClerk, useUser } from "@clerk/nextjs";
import {
  CreditCardIcon,
  LogOutIcon,
  MoreVerticalIcon,
  UserCircleIcon,
} from "lucide-react";
import Link from "next/link";
import router from "next/router";
import { useState } from "react";
import { toast } from "sonner";

export function NavUser() {
  const { user, isLoaded, isSignedIn } = useUser();
  const { isMobile } = useSidebar();
  const { signOut } = useClerk();
  const [isLoading, setIsLoading] = useState(false); // Add loading state

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
  const handleBillingPortal = async () => {
    setIsLoading(true);
    try {
      const hasActiveSubscription = await checkUserSubscription();
      if (!hasActiveSubscription) {
        router.push("/pricing"); // This is the correct way to redirect client-side
        return;
      }
      const fetchedPortalUrl = await createCustomerPortalProtected();

      // Check the success property first
      if (!fetchedPortalUrl.success) {
        toast.error("Too many requests. Please try again in a minute.");
        return;
      }
      const portalUrl = fetchedPortalUrl.data;
      if (typeof portalUrl === "string" && portalUrl.startsWith("http")) {
        window.location.href = portalUrl;
      } else {
        console.error(`Invalid portal URL received${portalUrl}`, portalUrl);
        toast("An error occured");
        // Optionally show an error toast/notification here
      }
    } catch (error) {
      console.error("Error opening billing portal:", error);
      // Optionally show an error toast/notification here
    } finally {
      setIsLoading(false);
    }
  };
  // Get user data from Clerk
  const userData = {
    name: user?.fullName,
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={userData.avatar} alt={userData.name ?? ""} />
                <AvatarFallback className="rounded-lg">
                  {userData.initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight ml-2">
                <span className="truncate font-medium">{userData.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {userData.email}
                </span>
              </div>
              <MoreVerticalIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage
                    src={userData.avatar}
                    alt={userData.name ?? ""}
                  />
                  <AvatarFallback className="rounded-lg">
                    {userData.initials}
                  </AvatarFallback>
                </Avatar>{" "}
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{userData.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {userData.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link href="/userProfile">
                  <UserCircleIcon className="mr-2 h-4 w-4" />
                  <span className="ml-1">Account</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                disabled={isLoading}
                onSelect={handleBillingPortal}
              >
                <CreditCardIcon className="mr-2 h-4 w-4" />
                <span className="ml-1">
                  {isLoading ? "Loading..." : "Billing"}
                </span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => signOut()}
              className="cursor-pointer"
            >
              <LogOutIcon className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
