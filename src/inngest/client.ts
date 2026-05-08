import { Inngest } from "inngest";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";

/**
 * Inngest v4 client. Checkpointing is enabled by default; we cap
 * maxRuntime to match Vercel's maxDuration so multi-step runs split
 * across invocations cleanly on Hobby's 300s ceiling.
 */
export const inngest = new Inngest({
  id: "sharetopus",
  maxRuntime: RUNTIME.maxDurationS * 1000,
});
