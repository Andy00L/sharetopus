import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY ?? "";

export const supabase = createClient(supabaseUrl, supabaseKey, {
  async accessToken() {
    return (await auth()).getToken();
  },
});
