import "server-only";

/**
 * Arc mainnet chain definition and the operations signer.
 *
 * The operations wallet named by X402_RECIPIENT_ARC both receives payments
 * and broadcasts them; gas on Arc is USDC, so each broadcast costs it a
 * fraction of a cent. Every Arc transaction (settlements and refunds) goes
 * through chain/broadcastCall.ts with this signer, so the two share one
 * nonce-safe send path.
 *
 * Called by: arc/arcFacilitator.ts (verify + settle), arc/refundArc.ts,
 *            arc/facilitatorApi.ts
 * Tables touched: none
 * Env: X402_ARC_KEY (operations key, held by the operator); the RPC URL is
 *      resolved by config.getRpcUrl (X402_ARC_RPC_URL override)
 */

import { defineChain } from "viem";

import { buildOperatorSigner, type OperatorSigner } from "@/lib/x402/chain/broadcastCall";
import { loadOperatorAccount } from "@/lib/x402/chain/operatorKey";
import { getRpcUrl } from "@/lib/x402/config";
import { NETWORKS } from "@/lib/x402/networks";

const ARC_NETWORK = NETWORKS.arc;

/**
 * Arc mainnet. Chain id and RPC come from the registry entry.
 *
 * nativeCurrency is USDC at 18 decimals on purpose: Arc exposes one asset
 * through two interfaces, the native gas balance at 18 decimals and the
 * ERC-20 at 6. Mixing the two scales is the classic Arc bug, so the token
 * side always goes through NetworkConfig.usdcDecimals instead of this field.
 */
export const ARC_CHAIN = defineChain({
  id: ARC_NETWORK.chainId,
  name: ARC_NETWORK.displayName,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_NETWORK.rpcUrl] } },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  },
});

export type ArcSignerResult =
  | { ok: true; signer: OperatorSigner }
  | { ok: false; message: string };

let cachedArcSigner: OperatorSigner | null = null;

/** The Arc operations signer, built once per process. Errors as values. */
export function getArcSigner(): ArcSignerResult {
  if (cachedArcSigner) return { ok: true, signer: cachedArcSigner };

  const accountResult = loadOperatorAccount("X402_ARC_KEY");
  if (!accountResult.ok) {
    return {
      ok: false,
      message: `${accountResult.message} Sharetopus settles Arc payments itself and cannot sign without it.`,
    };
  }

  cachedArcSigner = buildOperatorSigner({
    account: accountResult.account,
    chain: ARC_CHAIN,
    rpcUrl: getRpcUrl(ARC_NETWORK),
  });
  return { ok: true, signer: cachedArcSigner };
}
