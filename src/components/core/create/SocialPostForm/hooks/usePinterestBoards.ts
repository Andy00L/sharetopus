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

export function usePinterestBoards(userId: string | null) {
  const [boards, setBoards] = useState<BoardEntry[]>([]);
  const [checkedAccountIds, setCheckedAccountIds] = useState<string[]>([]);
  const [newBoardName, setNewBoardName] = useState("");
  const [isCreatingBoard, setIsCreatingBoard] = useState(false);
  const [isLoadingBoards, setIsLoadingBoards] = useState(false);

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

  async function loadBoardsForAccount(account: ClientSocialAccount) {
    if (!userId) return;
    if (checkedAccountIds.includes(account.id)) return;
    if (boards.some((entry) => entry.accountId === account.id)) return;

    await fetchAndSetBoards(account);
  }

  function unloadBoardsForAccount(accountId: string) {
    setBoards((prev) => prev.filter((entry) => entry.accountId !== accountId));
    setCheckedAccountIds((prev) => prev.filter((id) => id !== accountId));
  }

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
