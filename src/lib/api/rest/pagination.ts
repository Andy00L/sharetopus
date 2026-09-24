import { and, desc, lt, lte, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

/*
 * Keyset pagination for the REST list endpoints, newest first. Rows are
 * ordered by a sort column, then by id, a pair no two rows share, so a page
 * boundary never falls between rows that tie on the sort column. Paging on
 * the sort column alone skipped those rows: a batch scheduled in one INSERT
 * shares one created_at, and every analytics row of a day one metric_date.
 *
 * next_cursor is opaque to clients: base64url of the JSON pair
 * [sortKey, id] of the page's last row. base64url needs no URL-encoding.
 */

/** Where a page ended: the sort-column value and id of its last row. */
export type PagePosition = { sortKey: string; id: string };

const CURSOR_ERROR = "cursor must be a next_cursor value from a previous page";

/** Reads a cursor back into its JSON, or null when it is not base64url JSON. */
function decodeCursorJson(cursor: string): unknown {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * The `cursor` query parameter of a list endpoint whose sort column holds
 * values accepted by `sortKeySchema`. A cursor the API did not issue fails
 * validation, so the endpoint answers 400.
 */
function listCursorSchema(sortKeySchema: z.ZodType<string>) {
  return z
    .string()
    .transform(decodeCursorJson)
    .pipe(z.tuple([sortKeySchema, z.guid({ error: CURSOR_ERROR })], { error: CURSOR_ERROR }))
    .transform(([sortKey, id]): PagePosition => ({ sortKey, id }));
}

/** Cursor of the endpoints sorted by created_at (a timestamptz, microseconds kept). */
export const CreatedAtCursorSchema = listCursorSchema(
  z.iso.datetime({ offset: true, error: CURSOR_ERROR }),
);

/** Cursor of GET /v1/analytics, sorted by metric_date (a date). */
export const MetricDateCursorSchema = listCursorSchema(
  z.iso.date({ error: CURSOR_ERROR }),
);

/**
 * WHERE clause for the rows after `position` in newest-first order: a sort
 * value below the cursor's, or the same value with a lower id. The extra
 * `sortColumn <= sortKey` lets Postgres seek the (principal, sort column)
 * index straight to the cursor. No position (first page) adds no filter.
 */
export function rowsAfter(
  sortColumn: PgColumn,
  idColumn: PgColumn,
  position: PagePosition | undefined,
): SQL | undefined {
  if (!position) return undefined;
  return and(
    lte(sortColumn, position.sortKey),
    or(lt(sortColumn, position.sortKey), lt(idColumn, position.id)),
  );
}

/** ORDER BY for newest first, id breaking ties, matching rowsAfter. */
export function newestFirst(sortColumn: PgColumn, idColumn: PgColumn): SQL[] {
  return [desc(sortColumn), desc(idColumn)];
}

/**
 * Splits rows fetched with LIMIT limit + 1 into one page and its
 * next_cursor: the extra row only tells that another page exists.
 */
export function toListPage<Row extends { id: string }>(
  fetchedRows: Row[],
  limit: number,
  readSortKey: (row: Row) => string,
): { pageRows: Row[]; nextCursor: string | null; hasMore: boolean } {
  const hasMore = fetchedRows.length > limit;
  const pageRows = hasMore ? fetchedRows.slice(0, limit) : fetchedRows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? Buffer.from(JSON.stringify([readSortKey(lastRow), lastRow.id])).toString(
          "base64url",
        )
      : null;
  return { pageRows, nextCursor, hasMore };
}
