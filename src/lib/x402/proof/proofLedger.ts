import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { Json } from "@/lib/types/database.types";

/**
 * Public proof ledger behind /proof and the per-network pages.
 *
 * Reads the most recent x402 charges that reached a chain and resolves what
 * each payment bought and whether that post went live. Only values already
 * public on-chain (transaction hash, payer, amount) or harmless (network,
 * action, outcome, timestamp) leave this module. Principal ids, wallet ids,
 * nonces, request ids, error messages, and post content never do.
 *
 * Outcome resolution follows how each route records its work:
 *   - post-now stores metadata.batch_id on the charge; the post.now consumer
 *     writes content_history on success and failed_posts on failure, both
 *     keyed by that batch_id (src/inngest/functions/processDirectPostHelpers.ts,
 *     src/actions/server/contentHistoryActions/storeFailedPost.ts).
 *   - schedule wires x402_charges.scheduled_post_id; scheduled_posts.status
 *     carries the outcome.
 *   - every other action (connect, upload_url, list_*) buys no post.
 *
 * Called by: src/app/(marketing)/proof/page.tsx (every network),
 *            src/app/(marketing)/solana/page.tsx (scoped to solana)
 * Tables touched: x402_charges, content_history, failed_posts,
 *                 scheduled_posts (all read-only)
 */

/** Rows on the public page: enough to prove the lane, one screen tall. */
const LEDGER_LIMIT = 25;

/** Prefix shared by the three post actions. sourceRef: middleware/resolvePostAction.ts */
const POST_ACTION_PREFIX = "post.";

export type LedgerOutcome =
  | "published"
  | "publishing"
  | "scheduled"
  | "failed"
  | "cancelled"
  | "refunded"
  | "no_post"
  | "unlinked";

export interface ProofLedgerEntry {
  /** Registry slug of the network the payment settled on. */
  network: string;
  txHash: string;
  action: string;
  amountUsdc: number;
  payerAddress: string;
  outcome: LedgerOutcome;
  platform: string | null;
  /** ISO timestamp of settlement, falling back to charge creation. */
  settledAt: string;
}

export type ProofLedgerResult =
  | { ok: true; entries: ProofLedgerEntry[] }
  | { ok: false; reason: "ledger_read_failed" };

type PlatformByKey = Map<string, string | null>;

type ScheduledOutcome = {
  status:
    | "scheduled"
    | "queued"
    | "processing"
    | "posted"
    | "failed"
    | "cancelled";
  platform: string | null;
};

type LookupResult<Value> =
  | { ok: true; value: Value }
  | { ok: false };

/**
 * The ledger, newest first. Pass networkName to scope it to one lane;
 * omit it for the cross-network page.
 */
export async function loadProofLedger(options?: {
  networkName?: string;
}): Promise<ProofLedgerResult> {
  const baseQuery = adminSupabase
    .from("x402_charges")
    .select(
      "id, network, action, amount_usdc, status, tx_hash, payer_address, settled_at, created_at, metadata, scheduled_post_id",
    )
    .not("tx_hash", "is", null);
  const scopedQuery = options?.networkName
    ? baseQuery.eq("network", options.networkName)
    : baseQuery;

  const { data: chargeRows, error: chargesError } = await scopedQuery
    .order("created_at", { ascending: false })
    .limit(LEDGER_LIMIT);

  if (chargesError) {
    console.error(
      `[loadProofLedger] x402_charges read failed: ${chargesError.message}`,
    );
    return { ok: false, reason: "ledger_read_failed" };
  }

  const charges = chargeRows ?? [];
  const batchIds = charges
    .map((charge) => readBatchId(charge.metadata))
    .filter((batchId): batchId is string => batchId !== null);
  const scheduledPostIds = charges
    .map((charge) => charge.scheduled_post_id)
    .filter((postId): postId is string => postId !== null);

  const [publishedLookup, failedLookup, scheduledLookup] = await Promise.all([
    fetchPublishedPlatformsByBatch(batchIds),
    fetchFailedPlatformsByBatch(batchIds),
    fetchScheduledOutcomesById(scheduledPostIds),
  ]);
  // A secondary read failing would mislabel real posts as still publishing;
  // an honest error state beats a wrong ledger.
  if (!publishedLookup.ok || !failedLookup.ok || !scheduledLookup.ok) {
    return { ok: false, reason: "ledger_read_failed" };
  }

  const entries: ProofLedgerEntry[] = [];
  for (const charge of charges) {
    // Filtered server-side already; the narrow keeps the type honest.
    if (charge.tx_hash === null) continue;
    const resolved = resolveOutcome({
      chargeStatus: charge.status,
      action: charge.action,
      batchId: readBatchId(charge.metadata),
      scheduledPostId: charge.scheduled_post_id,
      publishedByBatch: publishedLookup.value,
      failedByBatch: failedLookup.value,
      scheduledById: scheduledLookup.value,
    });
    entries.push({
      network: charge.network,
      txHash: charge.tx_hash,
      action: charge.action,
      amountUsdc: charge.amount_usdc,
      payerAddress: charge.payer_address,
      outcome: resolved.outcome,
      platform: resolved.platform,
      settledAt: charge.settled_at ?? charge.created_at,
    });
  }

  return { ok: true, entries };
}

/** metadata.batch_id when post-now stored it; null for every other shape. */
function readBatchId(metadata: Json): string | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return null;
  }
  const batchId = metadata.batch_id;
  return typeof batchId === "string" && batchId.length > 0 ? batchId : null;
}

function resolveOutcome(params: {
  chargeStatus: "pending" | "settled" | "failed" | "refunded";
  action: string;
  batchId: string | null;
  scheduledPostId: string | null;
  publishedByBatch: PlatformByKey;
  failedByBatch: PlatformByKey;
  scheduledById: Map<string, ScheduledOutcome>;
}): { outcome: LedgerOutcome; platform: string | null } {
  if (params.chargeStatus === "refunded") {
    return { outcome: "refunded", platform: null };
  }
  if (params.chargeStatus === "failed") {
    return { outcome: "failed", platform: null };
  }
  if (!params.action.startsWith(POST_ACTION_PREFIX)) {
    return { outcome: "no_post", platform: null };
  }

  if (params.scheduledPostId !== null) {
    const scheduled = params.scheduledById.get(params.scheduledPostId);
    if (!scheduled) return { outcome: "unlinked", platform: null };
    return {
      outcome: mapScheduledStatus(scheduled.status),
      platform: scheduled.platform,
    };
  }

  if (params.batchId !== null) {
    if (params.publishedByBatch.has(params.batchId)) {
      return {
        outcome: "published",
        platform: params.publishedByBatch.get(params.batchId) ?? null,
      };
    }
    if (params.failedByBatch.has(params.batchId)) {
      return {
        outcome: "failed",
        platform: params.failedByBatch.get(params.batchId) ?? null,
      };
    }
    return { outcome: "publishing", platform: null };
  }

  return { outcome: "unlinked", platform: null };
}

function mapScheduledStatus(status: ScheduledOutcome["status"]): LedgerOutcome {
  switch (status) {
    case "posted":
      return "published";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "scheduled":
    case "queued":
    case "processing":
      return "scheduled";
  }
}

async function fetchPublishedPlatformsByBatch(
  batchIds: string[],
): Promise<LookupResult<PlatformByKey>> {
  const platformByBatch: PlatformByKey = new Map();
  if (batchIds.length === 0) return { ok: true, value: platformByBatch };

  const { data, error } = await adminSupabase
    .from("content_history")
    .select("batch_id, platform")
    .in("batch_id", batchIds)
    .eq("created_via", "x402");
  if (error) {
    console.error(
      `[fetchPublishedPlatformsByBatch] content_history read failed: ${error.message}`,
    );
    return { ok: false };
  }
  for (const row of data ?? []) {
    if (row.batch_id !== null) platformByBatch.set(row.batch_id, row.platform);
  }
  return { ok: true, value: platformByBatch };
}

async function fetchFailedPlatformsByBatch(
  batchIds: string[],
): Promise<LookupResult<PlatformByKey>> {
  const platformByBatch: PlatformByKey = new Map();
  if (batchIds.length === 0) return { ok: true, value: platformByBatch };

  const { data, error } = await adminSupabase
    .from("failed_posts")
    .select("batch_id, platform")
    .in("batch_id", batchIds);
  if (error) {
    console.error(
      `[fetchFailedPlatformsByBatch] failed_posts read failed: ${error.message}`,
    );
    return { ok: false };
  }
  for (const row of data ?? []) {
    if (row.batch_id !== null) platformByBatch.set(row.batch_id, row.platform);
  }
  return { ok: true, value: platformByBatch };
}

async function fetchScheduledOutcomesById(
  scheduledPostIds: string[],
): Promise<LookupResult<Map<string, ScheduledOutcome>>> {
  const outcomeById = new Map<string, ScheduledOutcome>();
  if (scheduledPostIds.length === 0) return { ok: true, value: outcomeById };

  const { data, error } = await adminSupabase
    .from("scheduled_posts")
    .select("id, status, platform")
    .in("id", scheduledPostIds);
  if (error) {
    console.error(
      `[fetchScheduledOutcomesById] scheduled_posts read failed: ${error.message}`,
    );
    return { ok: false };
  }
  for (const row of data ?? []) {
    outcomeById.set(row.id, { status: row.status, platform: row.platform });
  }
  return { ok: true, value: outcomeById };
}
