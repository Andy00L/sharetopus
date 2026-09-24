import { createClient } from "@supabase/supabase-js";
import "server-only";

type NoEntries = Record<never, never>;

/**
 * The schema this client is typed with: no tables, views or functions.
 * Every table query goes through Drizzle (src/db/client.ts), so
 * `adminSupabase.from(...)` is a type error instead of an untyped query.
 */
type StorageOnlyDatabase = {
  public: {
    Tables: NoEntries;
    Views: NoEntries;
    Functions: NoEntries;
    Enums: NoEntries;
    CompositeTypes: NoEntries;
  };
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE ?? "";

/** Service-role Supabase client for Storage; it bypasses the storage policies. */
export const adminSupabase = createClient<StorageOnlyDatabase>(
  supabaseUrl,
  supabaseServiceRole,
);
