// api/upstash.ts
"server only";

import { Redis } from "@upstash/redis";

// Create a Redis client
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Check for missing environment variables
if (
  !process.env.UPSTASH_REDIS_REST_URL ||
  !process.env.UPSTASH_REDIS_REST_TOKEN
) {
  console.warn(
    "🔴 Upstash Redis environment variables are missing. Rate limiting functionality will not work correctly."
  );
}
