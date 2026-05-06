import type { Database } from "@/lib/types/database.types"; // ← add this
import { createClient } from "@supabase/supabase-js";
import "server-only";

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE ?? "";

// Admin client that bypasses Row Level Security (RLS) policies
export const adminSupabase = createClient<Database>(
  supabaseUrl,
  supabaseServiceRole,
);
