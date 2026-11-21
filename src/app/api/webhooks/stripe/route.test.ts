import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { NextRequest } from "next/server";

type CompiledStatement = { sql: string; params: unknown[] };

const USER_ID = "user_owner";
const CUSTOMER_ID = "cus_owner";

const webhookState: {
  currentStatus: string;
  pausedFor: string[];
  demotedFor: string[];
  resumedFor: string[];
  promotedFor: string[];
} = { currentStatus: "active", pausedFor: [], demotedFor: [], resumedFor: [], promotedFor: [] };

function hasToSQL(query: unknown): query is { toSQL: () => CompiledStatement } {
  return typeof query === "object" && query !== null && "toSQL" in query;
}

function replyFor(statement: CompiledStatement) {
  if (statement.sql.includes('"creator_access_until"')) {
    return { data: [{ creator_access_until: null }], error: null };
  }
  if (statement.sql.includes('from "users"')) return { data: [{ id: USER_ID }], error: null };
  if (statement.sql.startsWith('insert into "stripe_subscriptions"')) return { data: [], error: null };
  if (statement.sql.includes('from "stripe_subscriptions"')) {
    const storedRow = {
      stripe_price_id: "price_monthly",
      status: webhookState.currentStatus,
      current_period_end: null,
      start_date: null,
    };
    return { data: [storedRow], error: null };
  }
  throw new Error(`[runQuery mock] unexpected statement: ${statement.sql}`);
}

function buildSubscription(status: string) {
  return {
    id: "sub_owner",
    object: "subscription",
    customer: CUSTOMER_ID,
    status,
    created: 1_763_000_000,
    items: { data: [{ current_period_end: 1_765_000_000, price: { id: "price_monthly" } }] },
  };
}

process.env.STRIPE_WEBHOOK_SECRET_DEV = "whsec_test_only";

mock.module("server-only", () => ({}));

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: unknown) => {
    if (!hasToSQL(query)) throw new Error("[runQuery mock] unexpected query");
    return replyFor(query.toSQL());
  },
}));

mock.module("@/lib/stripe", () => ({
  default: {
    webhooks: { constructEventAsync: async (body: string) => JSON.parse(body) },
    subscriptions: { retrieve: async () => buildSubscription(webhookState.currentStatus) },
  },
}));

mock.module("@/actions/server/stripe/stripeEventLog", () => ({
  isStripeEventProcessed: async () => ({ ok: true, isProcessed: false }),
  markStripeEventProcessed: async () => ({ ok: true }),
}));

mock.module("@/actions/server/stripe/recordInvoicePayment", () => ({
  recordInvoicePayment: async () => ({ ok: true }),
}));

mock.module("@/actions/server/data/cancelFutureScheduledPostsOnSubCancel", () => ({
  cancelFutureScheduledPostsOnSubCancel: async (principalId: string) => {
    webhookState.pausedFor.push(principalId);
    return { success: true, cancelled: 1 };
  },
}));

mock.module("@/actions/server/data/demoteOauthClientsOnCancel", () => ({
  demoteOauthClientsOnCancel: async (principalId: string) => {
    webhookState.demotedFor.push(principalId);
    return { success: true, demoted: 0 };
  },
}));

mock.module("@/actions/server/data/resumeCancelledPostsOnResubscribe", () => ({
  resumeCancelledPostsOnResubscribe: async (principalId: string) => {
    webhookState.resumedFor.push(principalId);
    return { success: true, resumed: 1, bumped: 1 };
  },
}));

mock.module("@/actions/server/data/promoteOauthClientsOnResubscribe", () => ({
  promoteOauthClientsOnResubscribe: async (principalId: string) => {
    webhookState.promotedFor.push(principalId);
    return { success: true, promoted: 0 };
  },
}));

const { POST } = await import("./route");

function deliverSubscriptionEvent(type: string, status: string) {
  webhookState.currentStatus = status;
  const event = { id: `evt_${type}_${status}`, type, livemode: false, data: { object: buildSubscription(status) } };
  return POST(
    new NextRequest("http://localhost/api/webhooks/stripe", {
      method: "POST",
      body: JSON.stringify(event),
      headers: { "stripe-signature": "t=1,v1=test" },
    }),
  );
}

beforeEach(() => {
  webhookState.pausedFor = [];
  webhookState.demotedFor = [];
  webhookState.resumedFor = [];
  webhookState.promotedFor = [];
});

describe("Stripe subscription webhook", () => {
  test("an update to past_due pauses future posts and demotes clients, like a deleted subscription", async () => {
    const response = await deliverSubscriptionEvent("customer.subscription.updated", "past_due");

    expect(response.status).toBe(200);
    expect(webhookState.pausedFor).toEqual([USER_ID]);
    expect(webhookState.demotedFor).toEqual([USER_ID]);
    expect(webhookState.resumedFor).toEqual([]);
  });

  test("a later update back to active resumes the paused posts", async () => {
    const response = await deliverSubscriptionEvent("customer.subscription.updated", "active");

    expect(response.status).toBe(200);
    expect(webhookState.resumedFor).toEqual([USER_ID]);
    expect(webhookState.promotedFor).toEqual([USER_ID]);
    expect(webhookState.pausedFor).toEqual([]);
  });
});
