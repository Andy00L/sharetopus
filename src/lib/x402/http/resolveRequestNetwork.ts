import "server-only";

/**
 * Resolves the network a request pays on (?network, else the default) and
 * the payout address for it. One implementation for every x402 entry point
 * (paid middleware, challenge GETs, /connect), so the unsupported-network
 * and missing-payout rules cannot drift between them.
 *
 * Called by: middleware/x402PaidEndpoint.ts, src/app/api/x402/connect/route.ts
 * Tables touched: none
 */

import { getRecipientAddress } from "@/lib/x402/config";
import {
  getDefaultNetwork,
  getNetworkConfig,
  type NetworkConfig,
} from "@/lib/x402/networks";

export type ResolveRequestNetworkResult =
  | { ok: true; network: NetworkConfig; recipientAddress: string }
  | { ok: false; reason: "unsupported_network"; message: string }
  | { ok: false; reason: "recipient_not_configured"; message: string };

export function resolveRequestNetwork(requestUrl: string): ResolveRequestNetworkResult {
  const networkParam = new URL(requestUrl).searchParams.get("network");
  const network = networkParam ? getNetworkConfig(networkParam) : getDefaultNetwork();
  if (!network) {
    return {
      ok: false,
      reason: "unsupported_network",
      message: `Network "${networkParam}" is not supported.`,
    };
  }

  const recipientAddress = getRecipientAddress(network);
  if (!recipientAddress) {
    console.error(
      `[resolveRequestNetwork] ${network.recipientEnvVar} is not set for network "${network.name}".`,
    );
    return {
      ok: false,
      reason: "recipient_not_configured",
      message: "Recipient address not configured for this network.",
    };
  }

  return { ok: true, network, recipientAddress };
}
