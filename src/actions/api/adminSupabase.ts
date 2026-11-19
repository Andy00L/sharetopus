import { createClient } from "@supabase/supabase-js";
import "server-only";

type NoEntries = Record<never, never>;

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
