import { getScheduledPosts } from "@/actions/server/scheduleActions/getScheduledPosts";
import RateLimitError from "@/components/RateLimitError";
import { SidebarGroup } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import NoData from "../posted/noData";
import BatchedPostCard from "./BatchedPostCard";
import { groupPostsIntoBatches } from "./calendar/calendarMath";
import EmptyContent from "./EmptyContent";

export default async function PostsGrid() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }
  const postsResult = await getScheduledPosts(userId, "web");

  if (!postsResult.success && postsResult.resetIn) {
    return <RateLimitError resetIn={postsResult.resetIn.toString()} />;
  }

  if (!postsResult.success) {
    return <NoData />;
  }
  if (!postsResult.data || postsResult.data.length === 0) {
    return <EmptyContent />;
  }

  return (
    <SidebarGroup className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {groupPostsIntoBatches(postsResult.data).map((batch) => (
        <BatchedPostCard
          key={batch.batchId}
          posts={batch.posts}
          userId={userId}
        />
      ))}
    </SidebarGroup>
  );
}
