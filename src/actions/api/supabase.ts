import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

import "server-only";

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY ?? "";

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  async accessToken() {
    return (await auth()).getToken();
  },
});
