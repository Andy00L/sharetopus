// components/core/scheduled/platform-options/PinterestOptions.tsx
"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getPinterestBoards,
  PinterestBoard,
} from "@/lib/api/pinterest/getPinterestBoards";
import { SocialAccount } from "@/lib/types/socialAccount";

// Define the Pinterest options type
export interface PinterestOptions {
  privacyLevel: string;
  board: string;
  link: string;
}

interface PinterestOptionsProps {
  readonly options: PinterestOptions;
  readonly onChange: (options: PinterestOptions) => void;
  readonly disabled?: boolean;
  readonly accountId?: string;
  readonly accounts?: SocialAccount[];
}

export function PinterestPostOptions({
  options,
  onChange,
  disabled = false,
  accountId,
  accounts = [],
}: PinterestOptionsProps) {
  const [boards, setBoards] = useState<PinterestBoard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handler for privacy level change
  const handlePrivacyChange = (value: string) => {
    onChange({
      ...options,
      privacyLevel: value,
    });
  };

  // Handler for board selection
  const handleBoardChange = (value: string) => {
    onChange({
      ...options,
      board: value,
    });
  };

  // Handler for link change
  const handleLinkChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...options,
      link: e.target.value,
    });
  };

  // Fetch boards when account ID changes
  useEffect(() => {
    async function loadBoards() {
      if (!accountId) return;

      setLoading(true);
      setError(null);

      try {
        // Find the selected Pinterest account
        const account = accounts.find((acc) => acc.id === accountId);

        if (!account || account.platform !== "pinterest") {
          console.log(
            "[Pinterest] No valid Pinterest account found for ID:",
            accountId
          );
          setBoards([]);
          setLoading(false);
          return;
        }

        // Log that we found the account and are about to fetch boards
        console.log("[Pinterest] Found account:", {
          id: account.id,
          platform: account.platform,
          hasToken: !!account.access_token,
          tokenStart: account.access_token
            ? account.access_token.substring(0, 10) + "..."
            : "none",
          username: account.username,
          displayName: account.display_name,
        });

        // Use the fixed function
        const fetchedBoards = await getPinterestBoards(account.access_token);
        console.log(
          "[Pinterest] Successfully fetched boards in component:",
          fetchedBoards
        );

        if (fetchedBoards.length === 0) {
          console.log("[Pinterest] No boards found for this account");
          // Check if we should recommend creating boards
          setError(
            "No Pinterest boards found. Please create a board on Pinterest before scheduling."
          );
        }

        setBoards(fetchedBoards);
      } catch (err) {
        console.error("[Pinterest] Error fetching boards in component:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load your Pinterest boards"
        );
        setBoards([]);
      } finally {
        setLoading(false);
      }
    }

    console.log(
      "[Pinterest] Board loading effect triggered for account:",
      accountId
    );
    loadBoards();
  }, [accountId, accounts]);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Pinterest Post Options</h3>

      {/* Privacy Level */}
      <div className="space-y-2">
        <Label htmlFor="privacyLevel">Visibility</Label>
        <Select
          value={options.privacyLevel}
          onValueChange={handlePrivacyChange}
          disabled={disabled}
        >
          <SelectTrigger id="privacyLevel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PUBLIC">Public</SelectItem>
            <SelectItem value="PROTECTED">Protected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Board Selection */}
      <div className="space-y-2">
        <Label htmlFor="board">Board</Label>
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <>
            <Select
              value={options.board}
              onValueChange={handleBoardChange}
              disabled={disabled}
            >
              <SelectTrigger id="board">
                <SelectValue placeholder="Select a board" />
              </SelectTrigger>
              <SelectContent>
                {boards.length === 0 ? (
                  <SelectItem value="no-boards-available" disabled>
                    No boards available
                  </SelectItem>
                ) : (
                  boards.map((board) => (
                    <SelectItem key={board.id} value={board.id}>
                      {board.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>

            {boards.length === 0 && !loading && (
              <div className="mt-2 text-sm text-amber-600">
                <p>
                  You need to create a board on Pinterest before you can
                  schedule posts.
                </p>
                <a
                  href="https://www.pinterest.com/settings/boards/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline mt-1 inline-block"
                >
                  Create a board on Pinterest
                </a>
              </div>
            )}

            {error && <div className="mt-2 text-sm text-red-500">{error}</div>}
          </>
        )}
      </div>

      {/* Link URL */}
      <div className="space-y-2">
        <Label htmlFor="link">Link URL (Optional)</Label>
        <Input
          id="link"
          type="url"
          placeholder="https://example.com"
          value={options.link}
          onChange={handleLinkChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
