import type { StoredCredential } from "@/lib/api/refreshWithAccountLock";
import { decryptToken } from "@/lib/crypto/tokenEncryption";

export type FakeAccountRow = StoredCredential & {
  id: string;
  platform: string;
  is_available: boolean;
};

type BuiltStatement = { sql: string; params: unknown[] };
type BuiltQuery = { toSQL: () => BuiltStatement };
type StoreAnswer = "commit" | "commit_and_lose_reply" | "fail";

export type SocialAccountRowHooks = {
  afterSelect: () => void;
  failSelect: () => boolean;
  beforeStoreApplies: (storeNumber: number) => Promise<StoreAnswer>;
  afterStoreApplies: (storeNumber: number) => Promise<void>;
  beforeFlagApplies: () => Promise<void>;
};

const QUERY_ERROR = { message: "connection reset", code: null };

function buildDefaultHooks(): SocialAccountRowHooks {
  return {
    afterSelect: () => undefined,
    failSelect: () => false,
    beforeStoreApplies: async () => "commit",
    afterStoreApplies: async () => undefined,
    beforeFlagApplies: async () => undefined,
  };
}

function readClause(sqlText: string, keyword: string, endKeywords: string[]): string {
  const clause = sqlText.split(` ${keyword} `)[1] ?? "";
  return endKeywords.reduce((remaining, endKeyword) => remaining.split(` ${endKeyword} `)[0], clause);
}

function readSetAssignments(statement: BuiltStatement): Map<string, unknown> {
  const assignments = readClause(statement.sql, "set", ["where"]).split(", ");
  return new Map(
    assignments.map((assignment) => {
      const assignmentMatch = /^"(\w+)" = \$(\d+)$/.exec(assignment);
      if (!assignmentMatch) throw new Error(`[readSetAssignments] Unexpected SET: ${assignment}`);
      return [assignmentMatch[1], statement.params[Number(assignmentMatch[2]) - 1]];
    }),
  );
}

function isSameInstant(storedValue: unknown, boundValue: unknown): boolean {
  if (storedValue === null || boundValue === null) return storedValue === boundValue;
  return (
    typeof storedValue === "string" &&
    typeof boundValue === "string" &&
    Date.parse(storedValue) === Date.parse(boundValue)
  );
}

function matchesWhereClause(statement: BuiltStatement, row: FakeAccountRow): boolean {
  const rowValues: Record<string, unknown> = { ...row };
  const whereClause = readClause(statement.sql, "where", ["returning", "limit"]).replace(/^\(|\)$/g, "");
  return whereClause.split(" and ").every((condition) => {
    const isNullMatch = /^"social_accounts"\."(\w+)" is null$/.exec(condition);
    if (isNullMatch) return rowValues[isNullMatch[1]] === null;
    const deadlineMatch = /^clock_timestamp\(\) < \$(\d+)::timestamptz$/.exec(condition);
    if (deadlineMatch) return Date.now() < Date.parse(String(statement.params[Number(deadlineMatch[1]) - 1]));
    const equalsMatch = /^"social_accounts"\."(\w+)" = \$(\d+)$/.exec(condition);
    if (!equalsMatch) throw new Error(`[matchesWhereClause] Unexpected WHERE: ${condition}`);
    const boundValue = statement.params[Number(equalsMatch[2]) - 1];
    return equalsMatch[1] === "token_expires_at"
      ? isSameInstant(rowValues.token_expires_at, boundValue)
      : rowValues[equalsMatch[1]] === boundValue;
  });
}

function applyAssignments(row: FakeAccountRow, assignments: Map<string, unknown>): FakeAccountRow {
  const updatedRow = { ...row };
  for (const [column, value] of assignments) {
    if (column === "access_token" || column === "refresh_token") {
      updatedRow[column] = typeof value === "string" ? decryptToken(value) : null;
    } else if (column === "token_expires_at") {
      updatedRow.token_expires_at = typeof value === "string" ? value : null;
    } else if (column === "is_available") {
      updatedRow.is_available = value === true;
    }
  }
  return updatedRow;
}

export function createSocialAccountRowFake() {
  let row: FakeAccountRow | null = null;
  let storeCount = 0;
  let hooks = buildDefaultHooks();

  async function runQuery(query: BuiltQuery) {
    const statement = query.toSQL();
    if (statement.sql.startsWith("select")) {
      const selectedRow = row && matchesWhereClause(statement, row) ? row : null;
      hooks.afterSelect();
      if (hooks.failSelect()) return { data: null, error: QUERY_ERROR };
      if (!selectedRow) return { data: [], error: null };
      const { access_token, refresh_token, token_expires_at } = selectedRow;
      return { data: [{ access_token, refresh_token, token_expires_at }], error: null };
    }

    const assignments = readSetAssignments(statement);
    const isStore = assignments.has("access_token");
    const storeNumber = isStore ? ++storeCount : 0;
    const storeAnswer = isStore ? await hooks.beforeStoreApplies(storeNumber) : "commit";
    if (!isStore) await hooks.beforeFlagApplies();
    if (storeAnswer === "fail") return { data: null, error: QUERY_ERROR };
    const matchedRow = row !== null && matchesWhereClause(statement, row) ? row : null;
    if (matchedRow) row = applyAssignments(matchedRow, assignments);
    if (isStore) await hooks.afterStoreApplies(storeNumber);
    if (storeAnswer === "commit_and_lose_reply") return { data: null, error: QUERY_ERROR };
    const returnsRows = statement.sql.includes(" returning ");
    return { data: matchedRow && returnsRows ? [{ id: matchedRow.id }] : [], error: null };
  }

  return {
    runQuery,
    readRow: () => row,
    countStores: () => storeCount,
    reset: (initialRow: FakeAccountRow | null) => {
      row = initialRow;
      storeCount = 0;
      hooks = buildDefaultHooks();
    },
    replaceRow: (nextRow: FakeAccountRow | null) => {
      row = nextRow;
    },
    setHooks: (overrides: Partial<SocialAccountRowHooks>) => {
      hooks = { ...hooks, ...overrides };
    },
  };
}
