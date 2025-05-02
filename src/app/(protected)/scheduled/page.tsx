// app/(protected)/scheduled/page.tsx
import { getScheduledPostsGroupedByBatch } from "@/actions/server/scheduleActions/getScheduledPosts";
import NoData from "@/components/core/posted/noData";
import PostsGrid from "@/components/core/scheduled/PostsGrid";
import ScheduledPostsSkeleton from "@/components/suspense/scheduled/ScheduledPostsSkeleton";

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
    <Suspense fallback={<ScheduledPostsSkeleton />}>
      <ScheduledPostsWithData />
    </Suspense>
  );
}
