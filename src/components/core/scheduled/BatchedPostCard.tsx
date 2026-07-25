// components/core/scheduled/BatchedPostCard.tsx
"use client";

import { format } from "date-fns";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";

import { Check, Clock, X } from "lucide-react";

import SocialAvatarWrapper from "@/components/SocialAvatarWrapper";
import { ScheduledPostListItem } from "@/lib/types/dbTypes";
import BatchDetailDialog from "./BatchDetailDialog";
import { POST_STATUS_STYLES, summarizeBatchStatus } from "./statusStyles";

interface BatchedPostCardProps {
  readonly posts: ScheduledPostListItem[];
  readonly userId: string;
}

/** Icon shown inside the status badge, per status family. */
function StatusBadgeIcon({ status }: { readonly status: string }) {
  switch (status) {
    case "scheduled":
    case "queued":
      return <Clock className="h-3 w-3" />;
    case "processing":
      return <Clock className="h-3 w-3 animate-spin" />;
    case "posted":
      return <Check className="h-3 w-3" />;
    case "failed":
    case "cancelled":
      return <X className="h-3 w-3" />;
    default:
      return null;
  }
}

export default function BatchedPostCard({
  posts,
  userId,
}: BatchedPostCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Use the first post for main display info
  const firstPost = posts[0];
  const scheduledDate = new Date(firstPost.scheduled_at);
  const formattedDate = format(scheduledDate, "MMM d, yyyy 'at' h:mm a");

  const batchStatus = summarizeBatchStatus(posts.map((post) => post.status));
  const statusStyle = POST_STATUS_STYLES[batchStatus];

  // Get media type
  const mediaType = firstPost.media_type;

  return (
    <>
      {/* Main Card */}
      <Card
        className="overflow-hidden border shadow-sm h-full cursor-pointer transition-all duration-200 hover:shadow-md hover:bg-accent/50 "
        onClick={() => setIsOpen(true)}
      >
        <CardHeader>
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground font-medium">
              {formattedDate}
            </span>
            <div className="flex gap-2">
              <Badge
                variant="outline"
                className={`gap-1 ${statusStyle.textClass} ${statusStyle.borderClass}`}
              >
                <StatusBadgeIcon status={batchStatus} />
                {statusStyle.label}
              </Badge>
              <Badge variant="secondary" className="capitalize">
                {mediaType}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardFooter className="p-3 pt-0 mt-auto">
          {/* Show avatars for all social accounts */}
          <div className="flex gap-2 pt-3 pl-3 items-center overflow-x-auto  w-full">
            {posts.map((post) => (
              <SocialAvatarWrapper
                key={post.id}
                src={post.social_accounts?.avatar_url}
                alt={`${post.platform} Account`}
                platform={post.platform}
                className="h-8 w-8 flex-shrink-0"
                size={32}
              />
            ))}
          </div>
        </CardFooter>
      </Card>

      <BatchDetailDialog
        posts={posts}
        userId={userId}
        open={isOpen}
        onOpenChange={setIsOpen}
      />
    </>
  );
}
