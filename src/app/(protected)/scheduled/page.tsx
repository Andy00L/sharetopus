// app/(protected)/scheduled/page.tsx
import { getScheduledPosts } from "@/actions/server/scheduleActions/getScheduledPosts";
import PostsGrid from "@/components/core/scheduled/PostsGrid";

import { auth } from "@clerk/nextjs/server";

export default async function ScheduledPostsPage() {
  const { userId } = await auth();
  const posts = await getScheduledPosts(userId);

  return <PostsGrid posts={posts} userId={userId} />;
}
