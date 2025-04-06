"server only";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY ?? "";
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE ?? ""; // REMOVED NEXT_PUBLIC_ prefix

export const supabase = createClient(supabaseUrl, supabaseKey, {
  async accessToken() {
    return (await auth()).getToken();
  },
});
// Admin client that bypasses Row Level Security (RLS) policies
export const adminSupabase = createClient(supabaseUrl, supabaseServiceRole);
