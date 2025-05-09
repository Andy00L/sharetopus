// components/core/scheduled/PostsGrid.tsx
import { getScheduledPostsGroupedByBatch } from "@/actions/server/scheduleActions/getScheduledPosts";
import { SidebarGroup } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import NoData from "../posted/noData";
import BatchedPostCard from "./BatchedPostCard";
import EmptyContent from "./EmptyContent";

export default async function PostsGrid() {
  const { userId } = await auth();
  const postsResult = await getScheduledPostsGroupedByBatch(userId);

  if (!postsResult.success || !postsResult.data) {
    return <NoData />;
  }

  const posts = postsResult.data;

  // Get all batch IDs
  const batchIds = Object.keys(posts);

  const totalPosts = batchIds.reduce(
    (sum, batchId) => sum + posts[batchId].length,
    0
  );

  return (
    <>
      {totalPosts === 0 && <EmptyContent />}

      {totalPosts > 0 && (
        <SidebarGroup className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {batchIds.map((batchId) => (
            <BatchedPostCard
              key={batchId}
              posts={posts[batchId]}
              userId={userId}
            />
          ))}
        </SidebarGroup>
      )}
    </>
  );
}
