import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { ReferralSignupOutcome } from "@/lib/referral/recordReferralOnSignup";

type StepRunner = { run: <Result>(stepId: string, work: () => Promise<Result>) => Promise<Result> };
type CapturedHandler = (context: {
  event: { data: { new_user_id: string; referral_code: string } };
  step: StepRunner;
}) => Promise<unknown>;

const executedStepIds: string[] = [];
const grantedReferrerIds: string[] = [];
let attributionOutcome: ReferralSignupOutcome = { kind: "recorded", referrerId: "user_referrer" };
let isGrantFailing = false;
let capturedHandler: CapturedHandler | null = null;

mock.module("server-only", () => ({}));

mock.module("@/inngest/client", () => ({
  inngest: {
    createFunction: (_config: unknown, handler: CapturedHandler) => {
      capturedHandler = handler;
      return {};
    },
  },
}));

mock.module("@/lib/referral/recordReferralOnSignup", () => ({
  recordReferralOnSignup: async () => attributionOutcome,
}));

mock.module("@/lib/referral/triggerReferralGrant", () => ({
  triggerReferralGrant: async (referrerId: string) => {
    grantedReferrerIds.push(referrerId);
    return isGrantFailing ? { success: false, message: "RPC failed" } : { success: true, weeksGranted: 1 };
  },
}));

await import("./recordReferralSignup");

const stepRunner: StepRunner = {
  run: async (stepId, work) => {
    executedStepIds.push(stepId);
    return work();
  },
};

function runFunction(): Promise<unknown> {
  if (!capturedHandler) throw new Error("[recordReferralSignup.test] handler not captured");
  return capturedHandler({
    event: { data: { new_user_id: "user_new", referral_code: "ABC1234" } },
    step: stepRunner,
  });
}

beforeEach(() => {
  executedStepIds.length = 0;
  grantedReferrerIds.length = 0;
  attributionOutcome = { kind: "recorded", referrerId: "user_referrer" };
  isGrantFailing = false;
});

describe("recordReferralSignup", () => {
  test("records the referral, then grants the referrer in its own step", async () => {
    const result = await runFunction();

    expect(executedStepIds).toEqual(["record-referral", "grant-referral-rewards"]);
    expect(grantedReferrerIds).toEqual(["user_referrer"]);
    expect(result).toEqual({ kind: "recorded", referrerId: "user_referrer", weeksGranted: 1 });
  });

  test("skips the grant when the signup is not attributed", async () => {
    attributionOutcome = { kind: "not_attributed", reason: "self_referral" };

    await runFunction();

    expect(executedStepIds).toEqual(["record-referral"]);
    expect(grantedReferrerIds).toEqual([]);
  });

  test("throws so Inngest retries when the record or the grant fails", async () => {
    attributionOutcome = { kind: "failed", message: "insert failed" };
    await expect(runFunction()).rejects.toThrow("insert failed");
    expect(grantedReferrerIds).toEqual([]);

    attributionOutcome = { kind: "recorded", referrerId: "user_referrer" };
    isGrantFailing = true;
    await expect(runFunction()).rejects.toThrow("Reward grant failed");
  });
});
