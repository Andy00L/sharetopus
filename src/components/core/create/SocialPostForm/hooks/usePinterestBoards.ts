"use client";

import { useState } from "react";
import { createPinterestBoard } from "@/lib/api/pinterest/data/createPinterestBoard";
import { getPinterestBoards } from "@/lib/api/pinterest/data/getPinterestBoards";
import { SocialAccount } from "@/lib/types/dbTypes";
import { toast } from "sonner";

export type BoardEntry = {
  boardID: string;
  boardName: string;
  accountId: string;
  isSelected: boolean;
};

export function usePinterestBoards(userId: string | null) {
  const [boards, setBoards] = useState<BoardEntry[]>([]);
  const [checkedAccountIds, setCheckedAccountIds] = useState<string[]>([]);
  const [newBoardName, setNewBoardName] = useState("");
  const [isCreatingBoard, setIsCreatingBoard] = useState(false);
  const [isLoadingBoards, setIsLoadingBoards] = useState(false);

  /**
   * Called from handleAccountToggle when a Pinterest account is checked.
   * Idempotent: skips if boards for this account are already loaded.
   */
  async function loadBoardsForAccount(account: SocialAccount) {
    if (!userId) return;
    if (!account.access_token) return;
    if (checkedAccountIds.includes(account.id)) return;
    if (boards.some((b) => b.accountId === account.id)) return;

    setIsLoadingBoards(true);
    setCheckedAccountIds((prev) => [...prev, account.id]);

    const result = await getPinterestBoards(account.access_token, userId);

    if (result.success && result.boards.length > 0) {
      const formattedBoards = result.boards.map((board) => ({
        boardID: board.id,
        boardName: board.name,
        accountId: account.id,
        isSelected: false,
      }));
      setBoards((prev) => [...prev, ...formattedBoards]);
    } else {
      setBoards((prev) => [
        ...prev,
        {
          boardID: `no-boards-${account.id}`,
          boardName: "no-boards",
          accountId: account.id,
          isSelected: false,
        },
      ]);
    }

    setIsLoadingBoards(false);
  }

  /** Called when a Pinterest account is unchecked. */
  function unloadBoardsForAccount(accountId: string) {
    setBoards((prev) => prev.filter((b) => b.accountId !== accountId));
    setCheckedAccountIds((prev) => prev.filter((id) => id !== accountId));
  }

  /** Sets the isSelected flag for a specific board. */
  function selectBoard(accountId: string, boardId: string) {
    setBoards((prev) =>
      prev.map((board) => ({
        ...board,
        isSelected:
          board.accountId === accountId
            ? board.boardID === boardId
            : board.isSelected,
      }))
    );
  }

  /** Creates a new Pinterest board and reloads boards for the account. */
  async function handleCreateBoard(
    accountId: string,
    accounts: SocialAccount[]
  ) {
    if (!newBoardName.trim()) {
      toast.error("Please enter a board name");
      return;
    }

    const account = accounts.find((acc) => acc.id === accountId);
    if (!account?.access_token) return;

    setIsCreatingBoard(true);

    try {
      const result = await createPinterestBoard(
        account.access_token,
        newBoardName
      );

      if (result) {
        toast.success("Board created successfully!");
        setNewBoardName("");

        // Remove the "no-boards" placeholder and trigger refetch
        setBoards((prev) =>
          prev.filter(
            (b) => !(b.accountId === accountId && b.boardName === "no-boards")
          )
        );
        setCheckedAccountIds((prev) => prev.filter((id) => id !== accountId));

        // Reload boards for this account
        await loadBoardsForAccount(account);
      } else {
        toast.error("Failed to create board");
      }
    } catch {
      toast.error("Error creating board");
    } finally {
      setIsCreatingBoard(false);
    }
  }

  /** Called from resetForm. */
  function resetBoards() {
    setBoards([]);
    setCheckedAccountIds([]);
    setNewBoardName("");
    setIsCreatingBoard(false);
    setIsLoadingBoards(false);
  }

  return {
    boards,
    isLoadingBoards,
    newBoardName,
    setNewBoardName,
    isCreatingBoard,
    loadBoardsForAccount,
    unloadBoardsForAccount,
    selectBoard,
    handleCreateBoard,
    resetBoards,
  };
}
