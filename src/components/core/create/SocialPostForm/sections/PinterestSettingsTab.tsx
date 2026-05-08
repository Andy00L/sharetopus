"use client";

import AvatarWithFallback from "@/components/AvatarWithFallback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { Loader2 } from "lucide-react";
import type { BoardEntry } from "../hooks/usePinterestBoards";

interface PinterestSettingsTabProps {
  readonly selectedPinterestAccounts: SocialAccount[];
  readonly boards: BoardEntry[];
  readonly isLoadingBoards: boolean;
  readonly newBoardName: string;
  readonly setNewBoardName: (name: string) => void;
  readonly isCreatingBoard: boolean;
  readonly onCreateBoard: (accountId: string) => void;
  readonly onSelectBoard: (accountId: string, boardId: string) => void;
  readonly textInputs: { title: string; description: string; link: string };
  readonly onTitleChange: (title: string) => void;
  readonly platformOptions: PlatformOptions;
  readonly onLinkChange: (link: string) => void;
}

export default function PinterestSettingsTab({
  selectedPinterestAccounts,
  boards,
  isLoadingBoards,
  newBoardName,
  setNewBoardName,
  isCreatingBoard,
  onCreateBoard,
  onSelectBoard,
  textInputs,
  onTitleChange,
  platformOptions,
  onLinkChange,
}: PinterestSettingsTabProps) {
  return (
    <div className="space-y-4  ">
      {/* Board selection for each Pinterest account */}
      {selectedPinterestAccounts.map((account) => (
        <div
          key={`pinterest-${account.id}`}
          className="space-y-3 border rounded p-3 bg-[#e6e6e1]"
        >
          <div className="flex items-center gap-2">
            <AvatarWithFallback
              src={account.avatar_url}
              alt={account.username ?? "Account"}
              size={42}
              className="h-8 w-8"
            />
            <span className="font-medium">
              {account.display_name ?? account.username}
            </span>
          </div>

          {isLoadingBoards && (
            <div className="p-2 border rounded-md text-gray-500">
              Loading boards...
            </div>
          )}

          {!isLoadingBoards &&
            boards.some(
              (board) =>
                board.accountId === account.id &&
                board.boardName === "no-boards"
            ) && (
              <div className="flex gap-2 bg-white">
                <Input
                  placeholder="Board name"
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                  disabled={isCreatingBoard}
                />
                <Button
                  onClick={() => onCreateBoard(account.id)}
                  disabled={isCreatingBoard || !newBoardName.trim()}
                >
                  {isCreatingBoard ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Create"
                  )}
                </Button>
              </div>
            )}

          {!isLoadingBoards &&
            boards.some(
              (board) =>
                board.accountId === account.id && board.boardName === "error"
            ) && (
              <div className="p-2 border rounded-md bg-white text-red-500">
                Error loading boards for this account. Please try reconnecting.
              </div>
            )}

          {!isLoadingBoards &&
            boards.filter((board) => board.accountId === account.id).length >
              0 && (
              <Select
                value={
                  boards.find(
                    (b) => b.accountId === account.id && b.isSelected
                  )?.boardID ?? ""
                }
                onValueChange={(boardId) => onSelectBoard(account.id, boardId)}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Select a board" />
                </SelectTrigger>
                <SelectContent>
                  {boards
                    .filter(
                      (board) =>
                        board.accountId === account.id &&
                        board.boardName !== "no-boards" &&
                        board.boardName !== "error"
                    )
                    .map((board) => (
                      <SelectItem
                        key={`${account.id}-${board.boardID}`}
                        value={board.boardID}
                      >
                        {board.boardName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
        </div>
      ))}
      {/* Single title field for all Pinterest accounts */}
      <div className="space-y-2 mb-4 ">
        <Label htmlFor="pinterest-title">Title (Optional)</Label>
        <Input
          id="pinterest-title"
          value={textInputs.title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="bg-white"
          placeholder="Add a title for all Pinterest pins"
        />
      </div>
      {/* Single link field for all Pinterest accounts */}
      <div className="space-y-2 ">
        <Label htmlFor="pinterest-link">Link (Optional)</Label>
        <Input
          id="pinterest-link"
          type="url"
          value={platformOptions.pinterest?.link ?? ""}
          onChange={(e) => onLinkChange(e.target.value)}
          placeholder="https://example.com"
          className="bg-white"
        />
      </div>
    </div>
  );
}
