import { Inngest } from "inngest";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";

export const inngest = new Inngest({
  id: "sharetopus",
  maxRuntime: RUNTIME.maxDurationS * 1000,
});
