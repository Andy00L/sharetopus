"use client";

import { useState } from "react";
import {
  createPinterestBoardForAccount,
  getPinterestBoardsForAccount,
} from "@/lib/api/pinterest/data/pinterestBoardsForAccount";
import { ClientSocialAccount } from "@/lib/types/dbTypes";
import { toast } from "sonner";

export type BoardEntry = {
  boardID: string;
  boardName: string;
  accountId: string;
  isSelected: boolean;
};

/**
 * Board state for the Pinterest settings tab. All Pinterest API calls go
 * through the ForAccount server actions with an account id only; the
 * access token is resolved and refreshed server-side and never reaches
 * this hook.
 */
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
  async function fetchAndSetBoards(account: ClientSocialAccount) {
    if (!userId) return;

    setIsLoadingBoards(true);
    try {
      const result = await getPinterestBoardsForAccount(account.id);

      if (result.success && result.boards.length > 0) {
        const formatted: BoardEntry[] = result.boards.map((board) => ({
          boardID: board.id,
          boardName: board.name,
          accountId: account.id,
          isSelected: false,
        }));

        setBoards((prev) => [
          ...prev.filter((entry) => entry.accountId !== account.id),
          ...formatted,
        ]);
      } else {
        setBoards((prev) => [
          ...prev.filter((entry) => entry.accountId !== account.id),
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
  async function loadBoardsForAccount(account: ClientSocialAccount) {
    if (!userId) return;
    if (checkedAccountIds.includes(account.id)) return;
    if (boards.some((entry) => entry.accountId === account.id)) return;

    await fetchAndSetBoards(account);
  }

  /** Called when a Pinterest account is unchecked. */
  function unloadBoardsForAccount(accountId: string) {
    setBoards((prev) => prev.filter((entry) => entry.accountId !== accountId));
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
    accounts: ClientSocialAccount[]
  ) {
    if (!newBoardName.trim()) {
      toast.error("Please enter a board name");
      return;
    }

    const account = accounts.find(
      (candidateAccount) => candidateAccount.id === accountId
    );
    if (!account) return;

    setIsCreatingBoard(true);

    try {
      const result = await createPinterestBoardForAccount(
        account.id,
        newBoardName
      );

      if (result.success) {
        toast.success("Board created successfully!");
        setNewBoardName("");
        await fetchAndSetBoards(account);
      } else {
        toast.error(result.message || "Failed to create board");
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
