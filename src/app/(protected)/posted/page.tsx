import RenderPosts from "@/components/core/posted/renderPosts";
import ContentHistorySkeleton from "@/components/suspense/posted/ContentHistorySkeleton";
import { Suspense } from "react";

// Main component with suspense boundary
export default function page() {
  async function PostsContent() {
    return <RenderPosts />;
  }
  return (
    <div className="p-4 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Posted Content</h1>
        <p className="text-muted-foreground">
          View the history of all content posted to your social platforms
        </p>
      </div>
      <Suspense fallback={<ContentHistorySkeleton />}>
        <PostsContent />
      </Suspense>
    </div>
  );
}
