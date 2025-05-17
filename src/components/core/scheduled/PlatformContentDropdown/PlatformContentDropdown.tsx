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

  return (
    <div className="border rounded-md overflow-hidden">
      {/* Platform header - always visible */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/50"
        onClick={() => setExpanded(!expanded)}
      >
        <SocialAvatarWrapper
          src={post.social_accounts?.avatar_url}
          alt={`${post.platform} Account`}
          platform={post.platform}
          className="h-12 w-12"
          size={48}
        />
        <div className="flex-1">
          <p className="font-medium">{post.social_accounts?.display_name}</p>
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
        <div className="p-3 pt-0 border-t bg-muted/30 max-h-[150px] overflow-y-auto">
          {post.post_title && (
            <div className="mt-2">
              <p className="text-sm font-medium">Title:</p>
              <p className="text-sm text-muted-foreground">{post.post_title}</p>
            </div>
          )}

          {post.post_description && (
            <div className="mt-2">
              <p className="text-sm font-medium">Description:</p>
              <p className="text-sm text-muted-foreground  max-h-[60px] overflow-y-auto">
                {post.post_description}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
