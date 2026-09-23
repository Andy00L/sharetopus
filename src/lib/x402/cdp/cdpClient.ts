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
