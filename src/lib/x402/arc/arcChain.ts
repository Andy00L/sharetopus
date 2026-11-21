import "server-only";

import { defineChain } from "viem";

import { buildOperatorSigner, type OperatorSigner } from "@/lib/x402/chain/broadcastCall";
import { loadOperatorAccount } from "@/lib/x402/chain/operatorKey";
import { getRpcUrl } from "@/lib/x402/config";
import { NETWORKS } from "@/lib/x402/networks";

const ARC_NETWORK = NETWORKS.arc;

export const ARC_CHAIN = defineChain({
  id: ARC_NETWORK.chainId,
  name: ARC_NETWORK.displayName,
  // Arc exposes USDC twice: the native gas balance at 18 decimals and the ERC-20 at 6 (viem's own arc chain also uses 18).
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
