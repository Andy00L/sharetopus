import { and, desc, lt, lte, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

export type PagePosition = { sortKey: string; id: string };

const CURSOR_ERROR = "cursor must be a next_cursor value from a previous page";

function decodeCursorJson(cursor: string): unknown {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function listCursorSchema(sortKeySchema: z.ZodType<string>) {
  return z
    .string()
    .transform(decodeCursorJson)
    .pipe(z.tuple([sortKeySchema, z.guid({ error: CURSOR_ERROR })], { error: CURSOR_ERROR }))
    .transform(([sortKey, id]): PagePosition => ({ sortKey, id }));
}

export const CreatedAtCursorSchema = listCursorSchema(
  z.iso.datetime({ offset: true, error: CURSOR_ERROR }),
);

export const MetricDateCursorSchema = listCursorSchema(
  z.iso.date({ error: CURSOR_ERROR }),
);

// Postgres uses the redundant `sortColumn <= sortKey` as an index condition on
// the (principal, sort column) index; the OR alone stays a row filter. EXPLAIN
// ANALYZE on content_history (2026-11-21) shows both plans.
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

export function newestFirst(sortColumn: PgColumn, idColumn: PgColumn): SQL[] {
  return [desc(sortColumn), desc(idColumn)];
}

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
