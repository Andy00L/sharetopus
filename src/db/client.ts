import "server-only";

import { DrizzleQueryError } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/*
 * The Drizzle client for server code. DATABASE_URL is the Supabase
 * transaction pooler connection string (port 6543), which suits short-lived
 * serverless functions. It connects over TLS as the database owner and
 * bypasses row-level security the way the service-role key does, so this
 * module must never reach the browser.
 *
 * Tables and value lists live in src/db/schema.ts. Queries use the core
 * builder (db.select / insert / update / delete), wrapped in runQuery.
 */

/** Seconds an unused connection stays open before postgres.js closes it, so an idle warm function does not hold pooler slots. */
const IDLE_CONNECTION_TIMEOUT_SECONDS = 20;

/**
 * Database connections per function instance. Every invocation on a warm
 * instance shares this client, so the cap applies to the instance, not the
 * request; concurrent queries wait their turn on the one connection.
 * sourceRef: https://supabase.com/docs/guides/database/connecting-to-postgres
 * (serverless functions, Postgres.js example).
 */
const MAX_CONNECTIONS_PER_INSTANCE = 1;

function createDatabaseClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // Fails the build or the first import instead of shipping code that
    // cannot reach the database.
    throw new Error(
      "[createDatabaseClient] DATABASE_URL is not set. Use the Supabase transaction pooler connection string (port 6543).",
    );
  }
  const queryClient = postgres(databaseUrl, {
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

/** A failed query: Postgres' message and SQLSTATE code ("23505" is a unique violation), or the connection error. */
export interface DatabaseError {
  message: string;
  code: string | null;
}

export type QueryResult<Data> =
  | { data: Data; error: null }
  | { data: null; error: DatabaseError };

/**
 * Runs a Drizzle query and returns `{ data, error }` instead of throwing,
 * the shape supabase-js returned, so callers keep branching on `error`.
 *
 * Drizzle wraps driver errors in DrizzleQueryError, whose message carries
 * the SQL and every bound parameter (tokens included). Only the underlying
 * Postgres message and code are kept, so logging `error.message` stays safe.
 */
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
