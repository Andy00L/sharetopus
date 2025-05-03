// components/core/scheduled/PostsGrid.tsx
import { SidebarGroup } from "@/components/ui/sidebar";
import { ScheduledPost } from "@/lib/types/dbTypes";
import BatchedPostCard from "./BatchedPostCard";
import EmptyContent from "./EmptyContent";

interface PostsGridProps {
  readonly posts: Record<string, ScheduledPost[]>;
  readonly userId: string | null;
}

export default function PostsGrid({ posts, userId }: PostsGridProps) {
  // Get all batch IDs
  const batchIds = Object.keys(posts);
  const totalPosts = batchIds.reduce(
    (sum, batchId) => sum + posts[batchId].length,
    0
  );

  return (
    <>
      {/**
      //<SidebarGroup className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
      //  <div>
      //    <h1 className="text-2xl font-bold">Scheduled Posts</h1>
      //    <p className="text-muted-foreground">
      //      Manage your scheduled posts for all your social platforms
      //    </p>
      //  </div>
//
      //  {totalPosts > 0 && (
      //    <Button asChild className="ml-auto">
      //      <Link href="/create">Schedule New Post</Link>
      //    </Button>
      //  )}
      //</SidebarGroup>
 */}
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
