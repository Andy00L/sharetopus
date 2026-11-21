import { describe, expect, test } from "bun:test";

import { CreatedAtCursorSchema, encodeListCursor, toListPage } from "./pagination";

const LAST_ROW_ON_PAGE = {
  id: "5b0f2a3e-8c4d-4e1f-9a7b-3c2d1e0f9a8b",
  created_at: "2026-07-01T09:30:00.123456+00:00",
};

describe("list cursors", () => {
  test("a cursor the API issued decodes back to the position it encodes", () => {
    const position = { sortKey: LAST_ROW_ON_PAGE.created_at, id: LAST_ROW_ON_PAGE.id };
    expect(CreatedAtCursorSchema.parse(encodeListCursor(position))).toEqual(position);
  });

  test("next_cursor points at the last row of a full page and is null on the last page", () => {
    const nextRow = { id: "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f", created_at: "2026-06-30T08:00:00+00:00" };
    const fullPage = toListPage([LAST_ROW_ON_PAGE, nextRow], 1, (row) => row.created_at);
    const lastPage = toListPage([LAST_ROW_ON_PAGE], 1, (row) => row.created_at);

    expect(fullPage.nextCursor).toBe(
      encodeListCursor({ sortKey: LAST_ROW_ON_PAGE.created_at, id: LAST_ROW_ON_PAGE.id }),
    );
    expect(lastPage).toEqual({ pageRows: [LAST_ROW_ON_PAGE], nextCursor: null, hasMore: false });
  });
});
