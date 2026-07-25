// app/(protected)/scheduled/page.tsx
import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { auth } from "@clerk/nextjs/server";

import { getScheduledPosts } from "@/actions/server/scheduleActions/getScheduledPosts";
import ScheduleCalendar from "@/components/core/scheduled/calendar/ScheduleCalendar";
import PostsGrid from "@/components/core/scheduled/PostsGrid";
import NoData from "@/components/core/posted/noData";
import RateLimitError from "@/components/RateLimitError";
import ScheduleCalendarSkeleton from "@/components/suspense/scheduled/ScheduleCalendarSkeleton";
import ScheduledPostsSkeleton from "@/components/suspense/scheduled/ScheduledPostsSkeleton";
import { Button } from "@/components/ui/button";
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";

async function ScheduledPostsWithData() {
  return <PostsGrid />;
}

/**
 * Calendar data path: unlike the list, it also loads posted rows so
 * published posts stay visible in place on the grid.
 */
async function ScheduleCalendarWithData() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }
  const postsResult = await getScheduledPosts(userId, "web", {
    includePosted: true,
  });

  if (!postsResult.success && postsResult.resetIn) {
    return <RateLimitError resetIn={postsResult.resetIn.toString()} />;
  }
  if (!postsResult.success) {
    return <NoData />;
  }

  return <ScheduleCalendar posts={postsResult.data ?? []} userId={userId} />;
}

export default async function ScheduledPostsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const isListView = view === "list";

  return (
    <SidebarContent className="px-4 py-6">
      <SidebarGroup className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Scheduled Posts</h1>
          <p className="text-muted-foreground">
            Manage your scheduled posts for all your social platforms
          </p>
        </div>
        {isListView && (
          <Button asChild variant="outline" size="sm">
            <Link href="/scheduled">
              <CalendarDays className="mr-1.5 h-4 w-4" />
              Calendar view
            </Link>
          </Button>
        )}
      </SidebarGroup>
      {isListView ? (
        <Suspense fallback={<ScheduledPostsSkeleton />}>
          <ScheduledPostsWithData />
        </Suspense>
      ) : (
        <Suspense fallback={<ScheduleCalendarSkeleton />}>
          <ScheduleCalendarWithData />
        </Suspense>
      )}
    </SidebarContent>
  );
}
