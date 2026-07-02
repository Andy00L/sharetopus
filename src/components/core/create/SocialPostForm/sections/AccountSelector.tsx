"use client";

import SocialAvatarWrapper from "@/components/SocialAvatarWrapper";
import { Input } from "@/components/ui/input";
import { platformSupportsMediaType } from "@/lib/platforms/capabilities";
import { SocialAccount } from "@/lib/types/dbTypes";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { useState } from "react";

interface AccountSelectorProps {
  readonly accounts: SocialAccount[];
  readonly selectedAccounts: Record<string, boolean>;
  readonly onToggle: (accountId: string) => void;
  readonly postType: "text" | "image" | "video";
}

export default function AccountSelector({
  accounts,
  selectedAccounts,
  onToggle,
  postType,
}: AccountSelectorProps) {
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredAccounts = accounts.filter((account) => {
    // Hide accounts whose platform cannot publish this post type (e.g.
    // Pinterest for text posts, YouTube for image posts).
    if (!platformSupportsMediaType(account.platform, postType)) {
      return false;
    }

    if (searchQuery.trim()) {
      const searchFields = [
        account.username,
        account.display_name,
        account.platform,
      ]
        .filter(Boolean)
        .map((field) => field?.toLowerCase());
      return searchFields.some((field) =>
        field?.includes(searchQuery.toLowerCase())
      );
    }

    return true;
  });

  return (
    <div>
      <div className="flex-grow space-y-4">
        {/* Search bar */}
        <div className="relative">
          {!isSearchExpanded ? (
            <div className="inline-block ">
              <button
                onClick={() => setIsSearchExpanded(true)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-all duration-300 ease-in-out"
              >
                <Search className="h-3 w-3" />
                <span>Search & Filter</span>
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="inline-block">
                <button
                  onClick={() => setIsSearchExpanded(false)}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-all duration-300 ease-in-out"
                >
                  <Search className="h-3 w-3" />
                  <span>Search & Filter</span>
                  <ChevronUp className="h-3 w-3" />
                </button>
              </div>

              <div className=" bg-white border rounded-lg relative w-full transition-all duration-500 ease-out origin-top transform animate-in fade-in-0 slide-in-from-top-2">
                <Input
                  placeholder="Search accounts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full border-[0.5px] focus:ring-0 focus:border-gray-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-gray-300"
                  autoFocus
                />
              </div>
            </div>
          )}
        </div>

        {/* Account grid */}
        <div className="flex flex-row flex-wrap gap-4">
          {filteredAccounts.map((account) => (
            <div
              key={`grid-${account.id}`}
              className="relative cursor-pointer group"
              onClick={() => onToggle(account.id)}
            >
              <div
                className={`
                  relative transition-all duration-100
                  ${
                    !selectedAccounts[account.id]
                      ? "grayscale opacity-60 hover:opacity-80"
                      : "grayscale-0 opacity-100"
                  }
                `}
              >
                <SocialAvatarWrapper
                  src={account.avatar_url}
                  alt={account.username ?? "Account"}
                  platform={account.platform}
                  className="h-12 w-12"
                  size={48}
                  isSelected={!!selectedAccounts[account.id]}
                />
              </div>
              {/* Tooltip with account name on hover */}
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                {account.display_name ?? account.username}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
