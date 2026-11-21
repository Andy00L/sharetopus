import "server-only";

/**
 * Lazy CDP SDK client, shared by the refund senders that go through a CDP
 * Server Wallet (EVM on base/polygon/arbitrum, and Solana). Lives in its own
 * module so those senders do not import facilitator.ts, which imports them.
 *
 * Called by: cdp/refundCdpEvm.ts, solana/refundSolana.ts
 * Env: CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET (read by the SDK)
 */

import { CdpClient } from "@coinbase/cdp-sdk";

import type { RefundSendResult } from "@/lib/x402/chain/refundSender";
import { withTimeout } from "@/lib/x402/http/withTimeout";

/** The SDK's axios client sets no timeout (@coinbase/cdp-sdk openapi-client/cdpApiClient.ts). */
const CDP_SEND_TIMEOUT_MS = 15_000;

/** sourceRef: @coinbase/cdp-sdk 1.51.0 openapi-client/generated ErrorType. */
const CDP_IDEMPOTENCY_ERROR_TYPE = "idempotency_error";

let cdpClientInstance: CdpClient | null = null;

export type CdpClientResult =
  | { ok: true; client: CdpClient }
  | { ok: false; message: string };

export function getCdpClient(): CdpClientResult {
  if (cdpClientInstance) return { ok: true, client: cdpClientInstance };

  const missingVariables = [
    ["CDP_API_KEY_ID", process.env.CDP_API_KEY_ID],
    ["CDP_API_KEY_SECRET", process.env.CDP_API_KEY_SECRET],
    ["CDP_WALLET_SECRET", process.env.CDP_WALLET_SECRET],
  ]
    .filter(([, value]) => !value)
    .map(([variableName]) => variableName);

  if (missingVariables.length > 0) {
    return {
      ok: false,
      message: `Missing required env var(s): ${missingVariables.join(", ")}. Set them in .env.local or the Vercel environment settings.`,
    };
  }

  cdpClientInstance = new CdpClient();
  return { ok: true, client: cdpClientInstance };
}

/**
 * A timed-out CDP request keeps running and may still broadcast, so only a
 * 4xx answer from CDP proves a send was refused.
 */
export async function sendThroughCdp(params: {
  send: () => Promise<string>;
  operationName: string;
}): Promise<RefundSendResult> {
  try {
    const txHash = await withTimeout(params.send(), CDP_SEND_TIMEOUT_MS, params.operationName);
    return { status: "sent", txHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : `${params.operationName} failed.`;
    if (isRefusedByCdp(error)) {
      console.error(`[sendThroughCdp] CDP refused ${params.operationName}: ${message}`);
      return { status: "not_sent", message };
    }
    console.error(
      `[sendThroughCdp] ${params.operationName} has an unknown outcome and may still broadcast: ${message}`,
    );
    return { status: "outcome_unknown", txHash: null, message };
  }
}

/** sourceRef: @coinbase/cdp-sdk 1.51.0 openapi-client/errors.ts (APIError.statusCode is 0 when no response arrived). */
function isRefusedByCdp(error: unknown): boolean {
  if (!(error instanceof Error) || !("statusCode" in error)) return false;
  const isClientError =
    typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500;
  const isAboutOurIdempotencyKey =
    "errorType" in error && error.errorType === CDP_IDEMPOTENCY_ERROR_TYPE;
  return isClientError && !isAboutOurIdempotencyKey;
}
