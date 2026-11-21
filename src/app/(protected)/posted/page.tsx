import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import RenderPosts from "@/components/core/posted/renderPosts";
import { InactiveSubscriptionNotice } from "@/components/InactiveSubscriptionNotice";
import ContentHistorySkeleton from "@/components/suspense/posted/ContentHistorySkeleton";
import { SidebarGroup } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";

function PostedPageShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="px-4 py-6">
      <SidebarGroup className="mb-6">
        <h1 className="text-2xl font-bold">Posted Content</h1>
        <p className="text-muted-foreground">
          View the history of all content posted to your social platforms
        </p>
      </SidebarGroup>
      {children}
    </div>
  );
}

async function PostedContentForSubscriber() {
  const { userId } = await auth();
  const subscription = await checkActiveSubscription(userId);
  if (!subscription.isActive) {
    return <InactiveSubscriptionNotice status={subscription.status} />;
  }
  return (
    <PostedPageShell>
      <RenderPosts />
    </PostedPageShell>
  );
}

export default function PostedPage() {
  return (
    <Suspense
      fallback={
        <PostedPageShell>
          <ContentHistorySkeleton />
        </PostedPageShell>
      }
    >
      <PostedContentForSubscriber />
    </Suspense>
  );
}
