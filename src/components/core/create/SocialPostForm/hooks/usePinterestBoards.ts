"use client";

import { useState } from "react";
import {
  createPinterestBoardForAccount,
  getPinterestBoardsForAccount,
} from "@/lib/api/pinterest/data/pinterestBoardsForAccount";
import { ClientSocialAccount } from "@/lib/types/dbTypes";
import { toast } from "sonner";
import {
  listBoardEntries,
  selectAccountBoard,
  toAccountBoards,
  type BoardsByAccount,
} from "../state/accountBoards";

export function usePinterestBoards(userId: string | null) {
  const [boardsByAccount, setBoardsByAccount] = useState<BoardsByAccount>({});
  const [newBoardName, setNewBoardName] = useState("");
  const [isCreatingBoard, setIsCreatingBoard] = useState(false);
  const [isLoadingBoards, setIsLoadingBoards] = useState(false);

  async function fetchAndSetBoards(account: ClientSocialAccount) {
    if (!userId) return;

    setIsLoadingBoards(true);
    try {
      const response = await getPinterestBoardsForAccount(account.id);
      setBoardsByAccount((previous) => ({
        ...previous,
        [account.id]: toAccountBoards(account.id, response),
      }));
    } catch (fetchError) {
      console.error(
        "[usePinterestBoards] Board fetch failed:",
        fetchError instanceof Error ? fetchError.message : fetchError,
      );
      setBoardsByAccount((previous) => ({
        ...previous,
        [account.id]: toAccountBoards(account.id, { success: false, failure: "unavailable" }),
      }));
    } finally {
      setIsLoadingBoards(false);
    }
  }

  async function loadBoardsForAccount(account: ClientSocialAccount) {
    if (!userId) return;
    if (boardsByAccount[account.id]?.status === "loaded") return;

    await fetchAndSetBoards(account);
  }

  function unloadBoardsForAccount(accountId: string) {
    setBoardsByAccount((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([loadedAccountId]) => loadedAccountId !== accountId),
      ),
    );
  }

  function selectBoard(accountId: string, boardId: string) {
    setBoardsByAccount((previous) => selectAccountBoard(previous, accountId, boardId));
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
    setBoardsByAccount({});
    setNewBoardName("");
    setIsCreatingBoard(false);
    setIsLoadingBoards(false);
  }

  return {
    boards: listBoardEntries(boardsByAccount),
    boardsByAccount,
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
