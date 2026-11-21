import { describe, expect, mock, test } from "bun:test";
import type { Jsonify } from "inngest/types";

import type { SocialAccount } from "@/lib/types/dbTypes";

const STORED_ACCOUNT: SocialAccount = {
  id: "account-1",
  principal_id: "principal-1",
  platform: "linkedin",
  account_identifier: "identifier-1",
  display_name: null,
  username: null,
  email_address: null,
  avatar_url: null,
  is_verified: null,
  follower_count: null,
  following_count: null,
  bio_description: null,
  is_available: true,
  access_token: "secret-access-token",
  refresh_token: "secret-refresh-token",
  token_expires_at: null,
  connection_id: null,
  extra: {},
  created_at: "2026-11-20T00:00:00.000Z",
  updated_at: "2026-11-20T00:00:00.000Z",
  deleted_at: null,
};

mock.module("server-only", () => ({}));
mock.module("@/db/client", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => ({}) }) }) }),
  },
  runQuery: async () => ({ data: [STORED_ACCOUNT], error: null }),
}));

const { fetchAccountForPublish, WITHHELD_ACCOUNT_JSON } = await import("./fetchAccountForPublish");

type PublishAccount = Extract<
  Awaited<ReturnType<typeof fetchAccountForPublish>>,
  { success: true }
>["account"];

describe("fetchAccountForPublish", () => {
  test("an account returned from a step serializes without its tokens", async () => {
    const fetched = await fetchAccountForPublish(STORED_ACCOUNT.id);
    if (!fetched.success) throw new Error("expected an account");
    expect(fetched.account.access_token).toBe("secret-access-token");

    const storedStepOutput = JSON.stringify({ result: fetched });
    expect(storedStepOutput).not.toContain("secret");
    expect(JSON.parse(storedStepOutput)).toEqual({
      result: { success: true, account: WITHHELD_ACCOUNT_JSON },
    });
  });

  test("the typed step output has the withheld marker where the account was", () => {
    const storedAccount: Jsonify<{ account: PublishAccount }>["account"] = WITHHELD_ACCOUNT_JSON;
    expect(storedAccount).toBe(WITHHELD_ACCOUNT_JSON);
  });
});
