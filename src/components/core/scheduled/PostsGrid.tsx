// components/core/scheduled/PostsGrid.server.tsx

import { Button } from "@/components/ui/button";
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";
import { ScheduledPost } from "@/lib/types/dbTypes";
import Link from "next/link";
import EmptyContent from "./EmptyContent";
import PostCard from "./PostCard";

export default function PostsGrid({
  posts,
  userId,
}: {
  readonly posts: ScheduledPost[];
  readonly userId: string | null;
}) {
  return (
    <SidebarContent className=" px-4 py-6">
      <SidebarGroup className=" flex justify-between  mb-6">
        <div>
          <h1 className="text-2xl font-bold">Scheduled Posts</h1>
          <p className="text-muted-foreground">
            Manage your scheduled posts for all your social platforms
          </p>
        </div>

        {/* Pas d'onClick → peut rester server */}
        {posts.length !== 0 && (
          <Button asChild className="ml-auto">
            <Link href="/create">Schedule New Post</Link>
          </Button>
        )}
      </SidebarGroup>

      {posts.length === 0 && <EmptyContent />}

      {posts.length !== 0 && (
        <SidebarGroup className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} userId={userId} />
          ))}
        </SidebarGroup>
      )}
    </SidebarContent>
  );
}
