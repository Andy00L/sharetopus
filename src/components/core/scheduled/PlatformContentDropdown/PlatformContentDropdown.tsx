// components/core/scheduled/PlatformContentDropdown.tsx
"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import SocialAvatarWrapper from "@/components/SocialAvatarWrapper";
import { ScheduledPost } from "@/lib/types/dbTypes";

interface PlatformContentDropdownProps {
  post: ScheduledPost;
}

export default function PlatformContentDropdown({
  post,
}: PlatformContentDropdownProps) {
  const [expanded, setExpanded] = useState(false);
  const truncateText = (text: string, maxLength: number = 100) => {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };
  return (
    <div className="border rounded-md overflow-hidden">
      {/* Platform header - always visible */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/50"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`View scheduled content details for ${post.platform} post`}
      >
        <SocialAvatarWrapper
          src={post.social_accounts?.avatar_url}
          alt={`${post.platform} Account`}
          platform={post.platform}
          className="h-12 w-12"
          size={48}
        />
        <div className="flex-1">
          <p className="font-medium">
            {post.social_accounts?.display_name || "Connected account"}
          </p>
          <p className="text-xs text-muted-foreground">
            Platform:{" "}
            <span className="font-medium capitalize">{post.platform}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Status: <span className="font-medium">{post.status}</span>
          </p>
        </div>
        {/* Dropdown chevron */}
        <ChevronDown
          className={`h-5 w-5 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </div>

      {/* Content dropdown - visible when expanded */}
      {expanded && (
        <div className="p-3 pt-0 border-t bg-muted/30">
          <p className="text-xs font-medium text-muted-foreground mb-1">
            Platform content details
          </p>

          {post.post_title && (
            <div className="mt-2">
              <p className="text-sm font-medium">Title:</p>
              <p className="text-sm text-muted-foreground">{post.post_title}</p>
            </div>
          )}

          {post.post_description && (
            <div className="mt-2">
              <p className="text-sm font-medium">Description:</p>
              <p className="text-sm text-muted-foreground ">
                {truncateText(post.post_description, 120)}{" "}
              </p>
            </div>
          )}

          {!post.post_title && !post.post_description && (
            <p className="text-xs text-muted-foreground mt-2">
              No additional content details are available for this scheduled
              post.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
