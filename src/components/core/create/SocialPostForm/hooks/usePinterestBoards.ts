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
   * Private. Fetches boards for an account and rewrites the local
   * `boards` state so this account's entries reflect the latest server
   * response. Idempotent at the state level: existing rows for the
   * account are replaced, not appended. Does not consult dedup guards;
   * callers decide whether to dedupe.
   *
   * Uses functional setState everywhere to avoid stale closures.
   */
  async function fetchAndSetBoards(account: SocialAccount) {
    if (!userId || !account.access_token) return;

    setIsLoadingBoards(true);
    try {
      const result = await getPinterestBoards(account.access_token, userId);

      if (result.success && result.boards.length > 0) {
        const formatted: BoardEntry[] = result.boards.map((board) => ({
          boardID: board.id,
          boardName: board.name,
          accountId: account.id,
          isSelected: false,
        }));

        setBoards((prev) => [
          ...prev.filter((b) => b.accountId !== account.id),
          ...formatted,
        ]);
      } else {
        setBoards((prev) => [
          ...prev.filter((b) => b.accountId !== account.id),
          {
            boardID: `no-boards-${account.id}`,
            boardName: "no-boards",
            accountId: account.id,
            isSelected: false,
          },
        ]);
      }

      setCheckedAccountIds((prev) =>
        prev.includes(account.id) ? prev : [...prev, account.id]
      );
    } finally {
      setIsLoadingBoards(false);
    }
  }

  /**
   * Called from handleAccountToggle when a Pinterest account is checked.
   * Idempotent on repeated toggles: skips if boards for this account
   * are already loaded. First-time loads delegate to fetchAndSetBoards.
   */
  async function loadBoardsForAccount(account: SocialAccount) {
    if (!userId) return;
    if (!account.access_token) return;
    if (checkedAccountIds.includes(account.id)) return;
    if (boards.some((b) => b.accountId === account.id)) return;

    await fetchAndSetBoards(account);
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

  /**
   * Creates a new Pinterest board and forces a board refetch for the
   * account. Calls fetchAndSetBoards directly, bypassing
   * loadBoardsForAccount's dedup guards since we know the server data
   * just changed.
   */
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
        await fetchAndSetBoards(account);
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
