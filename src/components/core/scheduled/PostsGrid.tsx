// components/core/scheduled/PostsGrid.tsx
import { getScheduledPosts } from "@/actions/server/scheduleActions/getScheduledPosts";
import RateLimitError from "@/components/RateLimitError";
import { SidebarGroup } from "@/components/ui/sidebar";
import { ScheduledPost } from "@/lib/types/database.types";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import NoData from "../posted/noData";
import BatchedPostCard from "./BatchedPostCard";
import EmptyContent from "./EmptyContent";

export default async function PostsGrid() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }
  const postsResult = await getScheduledPosts(userId, "web");

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
  // Inline batch grouping (was getScheduledPostsGroupedByBatch)
  const groupedPosts = postsResult.data.reduce(
    (acc: Record<string, ScheduledPost[]>, post) => {
      const batchId = post.batch_id || "no-batch";
      if (!acc[batchId]) acc[batchId] = [];
      acc[batchId].push(post);
      return acc;
    },
    {},
  );

  const batchIds = Object.keys(groupedPosts);
  if (batchIds.length === 0) {
    return <EmptyContent />;
  }
  return (
    <SidebarGroup className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {batchIds.map((batchId) => (
        <BatchedPostCard
          key={batchId}
          posts={groupedPosts[batchId]}
          userId={userId}
        />
      ))}
    </SidebarGroup>
  );
}
