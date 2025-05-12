// components/core/scheduled/PostsGrid.tsx
import { getScheduledPostsGroupedByBatch } from "@/actions/server/scheduleActions/getScheduledPosts";
import RateLimitError from "@/components/RateLimitError";
import { SidebarGroup } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import NoData from "../posted/noData";
import BatchedPostCard from "./BatchedPostCard";
import EmptyContent from "./EmptyContent";

export default async function PostsGrid() {
  const { userId } = await auth();
  const postsResult = await getScheduledPostsGroupedByBatch(userId);

  // Handle rate limiting
  if (!postsResult.success && postsResult.resetIn) {
    return (
      <RateLimitError
        resetIn={postsResult.resetIn.toString()}
        // The current route will refresh when we return
      />
    );
  }

  // Handle other errors
  if (!postsResult.success) {
    return <NoData />;
  }
  // Handle empty data (success but no posts)
  if (!postsResult.data || Object.keys(postsResult.data).length === 0) {
    return <EmptyContent />;
  }
  const posts = postsResult.data;

  // Get all batch IDs
  const batchIds = Object.keys(posts);

  const totalPosts = batchIds.reduce(
    (sum, batchId) => sum + posts[batchId].length,
    0
  );

  // In case there are batches but they're all empty
  if (totalPosts === 0) {
    return <EmptyContent />;
  }
  return (
    <SidebarGroup className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {batchIds.map((batchId) => (
        <BatchedPostCard key={batchId} posts={posts[batchId]} userId={userId} />
      ))}
    </SidebarGroup>
  );
}
