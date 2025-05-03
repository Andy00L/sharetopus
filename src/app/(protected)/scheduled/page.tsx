// app/(protected)/scheduled/page.tsx
import { getScheduledPostsGroupedByBatch } from "@/actions/server/scheduleActions/getScheduledPosts";
import NoData from "@/components/core/posted/noData";
import PostsGrid from "@/components/core/scheduled/PostsGrid";
import ScheduledPostsSkeleton from "@/components/suspense/scheduled/ScheduledPostsSkeleton";
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";

import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";

const ScheduledPostsWithData = async () => {
  const { userId } = await auth();
  const postsResult = await getScheduledPostsGroupedByBatch(userId);
  if (!postsResult.success || !postsResult.data) {
    return <NoData />;
  }
  return <PostsGrid posts={postsResult.data} userId={userId} />;
};

export default async function ScheduledPostsPage() {
  return (
    <SidebarContent className="px-4 py-6">
      <SidebarGroup className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Scheduled Posts</h1>
          <p className="text-muted-foreground">
            Manage your scheduled posts for all your social platforms
          </p>
        </div>
      </SidebarGroup>
      <Suspense fallback={<ScheduledPostsSkeleton />}>
        <ScheduledPostsWithData />
      </Suspense>
    </SidebarContent>
  );
}
