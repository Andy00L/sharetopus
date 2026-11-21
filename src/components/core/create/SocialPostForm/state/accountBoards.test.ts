import { describe, expect, test } from "bun:test";

import { listBoardEntries, selectAccountBoard, toAccountBoards } from "./accountBoards";

const ACCOUNT_ID = "account-1";
const OTHER_ACCOUNT_ID = "account-2";

describe("Pinterest board state per account", () => {
  test("a failed board fetch becomes a failed state with a message, never a board row", () => {
    const failed = toAccountBoards(ACCOUNT_ID, { success: false, failure: "token_expired" });
    expect(failed.status).toBe("failed");
    expect(listBoardEntries({ [ACCOUNT_ID]: failed })).toEqual([]);
  });

  test("an account with no boards is loaded and empty, so the form offers to create one", () => {
    expect(toAccountBoards(ACCOUNT_ID, { success: true, boards: [], bookmark: null })).toEqual({
      status: "loaded",
      boards: [],
    });
  });

  test("selecting a board marks only that board of that account", () => {
    const boardsByAccount = {
      [ACCOUNT_ID]: toAccountBoards(ACCOUNT_ID, {
        success: true,
        boards: [
          { id: "board-a", name: "Recipes" },
          { id: "board-b", name: "Travel" },
        ],
        bookmark: null,
      }),
      [OTHER_ACCOUNT_ID]: toAccountBoards(OTHER_ACCOUNT_ID, {
        success: true,
        boards: [{ id: "board-c", name: "Garden" }],
        bookmark: null,
      }),
    };

    const selectedBoardIds = listBoardEntries(
      selectAccountBoard(boardsByAccount, ACCOUNT_ID, "board-b"),
    ).flatMap((board) => (board.isSelected ? [board.boardID] : []));

    expect(selectedBoardIds).toEqual(["board-b"]);
  });
});
