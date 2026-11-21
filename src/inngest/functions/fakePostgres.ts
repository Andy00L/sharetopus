type FakeValue = string | number | boolean | null;

export type FakeRow = Record<string, FakeValue>;

type StatementResult = { columns: string[]; rows: FakeRow[] };

type FakeQuery = {
  then: <Fulfilled, Rejected = never>(
    onFulfilled?: ((rows: FakeRow[]) => Fulfilled | PromiseLike<Fulfilled>) | null,
    onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
  ) => Promise<Fulfilled | Rejected>;
  values: () => Promise<FakeValue[][]>;
};

type FakeClient = {
  options: { parsers: Record<string, unknown>; serializers: Record<string, unknown> };
  unsafe: (statementSql: string, params?: unknown[]) => FakeQuery;
  begin: <Result>(transactionBody: (transactionClient: FakeClient) => Promise<Result>) => Promise<Result>;
};

export type FakeStatementFault = { statementPrefix: string; message: string };

export type FakePostgres = {
  tables: Map<string, FakeRow[]>;
  faults: FakeStatementFault[];
  client: FakeClient;
};

const SELECT_PATTERN = /^select (.+?) from "(\w+)"(?: where (.+?))?(?: order by .+?)?(?: limit \$(\d+))?$/;
const UPDATE_PATTERN = /^update "(\w+)" set (.+?)(?: where (.+?))?(?: returning (.+))?$/;
const COLUMN_PATTERN = /"(\w+)"$/;
const ASSIGNMENT_PATTERN = /"(\w+)" = \$(\d+)/g;
const WHERE_TOKEN_PATTERN =
  /"\w+"\."\w+" (?:is null|(?:=|<>|<) \$\d+|in \([^)]*\))|\(|\)|\band\b|\bor\b/g;
const ATOM_PATTERN = /^"\w+"\."(\w+)" (is null|=|<>|<|in) ?(?:\$(\d+)|\(([^)]*)\))?$/;

function toFakeValue(param: unknown): FakeValue {
  if (param === null || param === undefined) return null;
  if (typeof param === "string" || typeof param === "number" || typeof param === "boolean") return param;
  return JSON.stringify(param);
}

function readParam(params: unknown[], placeholder: string): FakeValue {
  return toFakeValue(params[Number(placeholder.replace("$", "")) - 1]);
}

function readColumnNames(columnListSql: string): string[] {
  return columnListSql.split(", ").map((columnSql) => {
    const columnMatch = COLUMN_PATTERN.exec(columnSql);
    if (!columnMatch) throw new Error(`[readColumnNames] Unexpected column: ${columnSql}`);
    return columnMatch[1];
  });
}

function isEarlier(storedValue: FakeValue, wantedValue: FakeValue): boolean {
  if (typeof storedValue !== "string" || typeof wantedValue !== "string") return false;
  return Date.parse(storedValue) < Date.parse(wantedValue);
}

function evaluateAtom(atomSql: string, row: FakeRow, params: unknown[]): boolean {
  const atomMatch = ATOM_PATTERN.exec(atomSql);
  if (!atomMatch) throw new Error(`[evaluateAtom] Unexpected condition: ${atomSql}`);
  const [, column, operator, placeholderIndex, inPlaceholders] = atomMatch;
  const storedValue = row[column] ?? null;
  if (operator === "is null") return storedValue === null;
  if (operator === "in") {
    return inPlaceholders
      .split(", ")
      .some((placeholder) => readParam(params, placeholder) === storedValue);
  }
  const wantedValue = readParam(params, `$${placeholderIndex}`);
  if (storedValue === null) return false;
  if (operator === "=") return storedValue === wantedValue;
  if (operator === "<>") return storedValue !== wantedValue;
  return isEarlier(storedValue, wantedValue);
}

function matchesWhere(whereSql: string | undefined, row: FakeRow, params: unknown[]): boolean {
  if (whereSql === undefined) return true;
  const tokens = whereSql.match(WHERE_TOKEN_PATTERN) ?? [];
  let position = 0;
  const readOperand = (): boolean => {
    const token = tokens[position];
    position += 1;
    if (token !== "(") return evaluateAtom(token, row, params);
    const groupValue = readGroup();
    position += 1;
    return groupValue;
  };
  const readGroup = (): boolean => {
    let groupValue = readOperand();
    while (tokens[position] === "and" || tokens[position] === "or") {
      const connective = tokens[position];
      position += 1;
      const operandValue = readOperand();
      groupValue = connective === "and" ? groupValue && operandValue : groupValue || operandValue;
    }
    return groupValue;
  };
  return readGroup();
}

function readTable(tables: Map<string, FakeRow[]>, tableName: string): FakeRow[] {
  const tableRows = tables.get(tableName);
  if (!tableRows) throw new Error(`[readTable] Unknown table: ${tableName}`);
  return tableRows;
}

function runSelect(tables: Map<string, FakeRow[]>, selectMatch: RegExpExecArray, params: unknown[]): StatementResult {
  const [, columnListSql, tableName, whereSql, limitPlaceholder] = selectMatch;
  const matchingRows = readTable(tables, tableName).filter((row) => matchesWhere(whereSql, row, params));
  const limit = limitPlaceholder === undefined ? matchingRows.length : Number(readParam(params, `$${limitPlaceholder}`));
  return { columns: readColumnNames(columnListSql), rows: matchingRows.slice(0, limit) };
}

function runUpdate(tables: Map<string, FakeRow[]>, updateMatch: RegExpExecArray, params: unknown[]): StatementResult {
  const [, tableName, assignmentsSql, whereSql, returningSql] = updateMatch;
  const assignments = [...assignmentsSql.matchAll(ASSIGNMENT_PATTERN)].map(([, column, placeholderIndex]) => ({
    column,
    value: readParam(params, `$${placeholderIndex}`),
  }));
  const updatedRows: FakeRow[] = [];
  const tableRows = readTable(tables, tableName).map((row) => {
    if (!matchesWhere(whereSql, row, params)) return row;
    const updatedRow = { ...row };
    for (const assignment of assignments) updatedRow[assignment.column] = assignment.value;
    updatedRows.push(updatedRow);
    return updatedRow;
  });
  tables.set(tableName, tableRows);
  return { columns: returningSql === undefined ? [] : readColumnNames(returningSql), rows: updatedRows };
}

function copyTables(tables: Map<string, FakeRow[]>): Map<string, FakeRow[]> {
  return new Map([...tables].map(([tableName, tableRows]) => [tableName, tableRows.map((row) => ({ ...row }))]));
}

export function createFakePostgres(): FakePostgres {
  const tables = new Map<string, FakeRow[]>();
  const faults: FakeStatementFault[] = [];

  const runStatement = (statementSql: string, params: unknown[]): StatementResult => {
    const faultIndex = faults.findIndex((fault) => statementSql.startsWith(fault.statementPrefix));
    if (faultIndex >= 0) {
      const [fault] = faults.splice(faultIndex, 1);
      throw new Error(fault.message);
    }
    const selectMatch = SELECT_PATTERN.exec(statementSql);
    if (selectMatch) return runSelect(tables, selectMatch, params);
    const updateMatch = UPDATE_PATTERN.exec(statementSql);
    if (updateMatch) return runUpdate(tables, updateMatch, params);
    throw new Error(`[runStatement] Unsupported statement: ${statementSql}`);
  };

  const client: FakeClient = {
    options: { parsers: {}, serializers: {} },
    unsafe: (statementSql, params = []) => {
      const execute = () => Promise.resolve().then(() => runStatement(statementSql, params));
      return {
        then: (onFulfilled, onRejected) =>
          execute()
            .then((result) => result.rows)
            .then(onFulfilled, onRejected),
        values: () =>
          execute().then((result) =>
            result.rows.map((row) => result.columns.map((column) => row[column] ?? null)),
          ),
      };
    },
    begin: async (transactionBody) => {
      const snapshot = copyTables(tables);
      try {
        return await transactionBody(client);
      } catch (transactionError) {
        tables.clear();
        for (const [tableName, tableRows] of snapshot) tables.set(tableName, tableRows);
        throw transactionError;
      }
    },
  };

  return { tables, faults, client };
}
