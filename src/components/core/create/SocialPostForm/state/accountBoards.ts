import type {
  PinterestBoardsFailure,
  PinterestBoardsResponse,
} from "@/lib/api/pinterest/data/getPinterestBoards";

export type BoardEntry = {
  boardID: string;
  boardName: string;
  accountId: string;
  isSelected: boolean;
};

export type AccountBoards =
  | { status: "loaded"; boards: BoardEntry[] }
  | { status: "failed"; message: string };

export type BoardsByAccount = Record<string, AccountBoards>;

const BOARD_FETCH_FAILURE_MESSAGES: Record<PinterestBoardsFailure, string> = {
  token_missing: "This Pinterest account needs to be reconnected before its boards can load.",
  token_expired: "This Pinterest account needs to be reconnected before its boards can load.",
  rate_limited: "Pinterest is limiting board lookups right now. Try again in a minute.",
  unavailable: "Boards could not be loaded. Try again in a moment.",
  upstream_error: "Pinterest did not return the boards. Try again in a moment.",
};

export function toAccountBoards(
  accountId: string,
  response: PinterestBoardsResponse,
): AccountBoards {
  if (!response.success) {
    return { status: "failed", message: BOARD_FETCH_FAILURE_MESSAGES[response.failure] };
  }
  return {
    status: "loaded",
    boards: response.boards.map((board) => ({
      boardID: board.id,
      boardName: board.name,
      accountId,
      isSelected: false,
    })),
  };
}

export function listBoardEntries(boardsByAccount: BoardsByAccount): BoardEntry[] {
  return Object.values(boardsByAccount).flatMap((accountBoards) =>
    accountBoards.status === "loaded" ? accountBoards.boards : [],
  );
}

export function selectAccountBoard(
  boardsByAccount: BoardsByAccount,
  accountId: string,
  boardId: string,
): BoardsByAccount {
  const accountBoards = boardsByAccount[accountId];
  if (accountBoards?.status !== "loaded") return boardsByAccount;
  return {
    ...boardsByAccount,
    [accountId]: {
      status: "loaded",
      boards: accountBoards.boards.map((board) => ({
        ...board,
        isSelected: board.boardID === boardId,
      })),
    },
  };
}
