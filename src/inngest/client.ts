import { Inngest } from "inngest";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";

// Inngest starts another step in the same request only until
// checkpointing.maxRuntime has elapsed, then hands the run back for a new
// request (node_modules/inngest/components/execution/engine.js:773).
export const inngest = new Inngest({
  id: "sharetopus",
  checkpointing: {
    maxRuntime: (RUNTIME.maxDurationS - RUNTIME.minStepBudgetS) * 1000,
  },
});
