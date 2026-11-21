import "server-only";

import { DrizzleQueryError } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const IDLE_CONNECTION_TIMEOUT_SECONDS = 20;

/**
 * Database connections per function instance. Every invocation on a warm
 * instance shares this client, so the cap applies to the instance, not the
 * request; concurrent queries wait their turn on the one connection.
 * sourceRef: https://supabase.com/docs/guides/database/connecting-to-postgres
 * (serverless functions, Postgres.js example).
 */
const MAX_CONNECTIONS_PER_INSTANCE = 1;

/**
 * postgres.js pipelines queries that have no bound values, and the transaction
 * pooler stalls the connection on them. max_pipeline=0 sends each query only
 * after the previous one finished. The option is read from the URL because the
 * package types omit it. sourceRef: node_modules/postgres/cjs/src/connection.js (max_pipeline).
 */
function disableQueryPipelining(databaseUrl: string): string {
  const connectionUrl = new URL(databaseUrl);
  connectionUrl.searchParams.set("max_pipeline", "0");
  return connectionUrl.toString();
}

function createDatabaseClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "[createDatabaseClient] DATABASE_URL is not set. Use the Supabase transaction pooler connection string (port 6543).",
    );
  }
  const queryClient = postgres(disableQueryPipelining(databaseUrl), {
    // postgres.js only negotiates TLS when asked, and the pooler also
    // accepts unencrypted connections, so without this every query and row
    // crossed the network in clear text. "require" encrypts without checking
    // the certificate chain, like Supabase's Postgres.js example.
    ssl: "require",
    max: MAX_CONNECTIONS_PER_INSTANCE,
    // The transaction pooler hands each transaction to any server
    // connection, so a statement prepared on one is gone on the next.
    prepare: false,
    idle_timeout: IDLE_CONNECTION_TIMEOUT_SECONDS,
  });
  return drizzle(queryClient);
}

export const db = createDatabaseClient();

export interface DatabaseError {
  message: string;
  code: string | null;
}

// SQLSTATE unique_violation: https://www.postgresql.org/docs/current/errcodes-appendix.html
const UNIQUE_VIOLATION_SQLSTATE = "23505";

export function isUniqueViolation(error: DatabaseError): boolean {
  return error.code === UNIQUE_VIOLATION_SQLSTATE;
}

export type QueryResult<Data> =
  | { data: Data; error: null }
  | { data: null; error: DatabaseError };

export async function runQuery<Data>(
  query: PromiseLike<Data>,
): Promise<QueryResult<Data>> {
  try {
    return { data: await query, error: null };
  } catch (thrown) {
    return { data: null, error: toDatabaseError(thrown) };
  }
}

function toDatabaseError(thrown: unknown): DatabaseError {
  // Never the wrapper's own message: it lists the bound parameters.
  const driverError = thrown instanceof DrizzleQueryError ? thrown.cause : thrown;
  if (driverError instanceof Error) {
    const errorCode: unknown = Reflect.get(driverError, "code");
    return {
      message: driverError.message,
      code: typeof errorCode === "string" ? errorCode : null,
    };
  }
  return { message: "Database query failed", code: null };
}
