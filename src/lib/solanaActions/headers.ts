import "server-only";

import { NETWORKS } from "@/lib/x402/networks";

/**
 * Response headers every Solana Actions route sends (actions.json and the
 * /api/actions/* handlers). Wide-open CORS is required by the spec so any
 * Blink client (dial.to, wallets) can call these routes; it is set here and
 * nowhere else on the site.
 *
 * sourceRef: @solana/actions v1.6.6 constants.js (ACTIONS_CORS_HEADERS),
 *            @solana/actions-spec v2.4.2
 */

/** Spec version advertised in X-Action-Version. sourceRef: @solana/actions-spec package.json */
const SOLANA_ACTIONS_SPEC_VERSION = "2.4.2";

// Module-load assertion, same pattern as networks.ts for "base": the
// blockchain id must come from the registry, never a second literal.
if (!NETWORKS.solana) {
  throw new Error(
    "[solanaActions/headers] Solana entry missing from NETWORKS. This is a build-time configuration error.",
  );
}
const SOLANA_BLOCKCHAIN_ID = NETWORKS.solana.caipNetwork;

const ACTIONS_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
  "Content-Type": "application/json",
} as const;

export function buildActionHeaders(): Record<string, string> {
  return {
    ...ACTIONS_CORS_HEADERS,
    "X-Action-Version": SOLANA_ACTIONS_SPEC_VERSION,
    "X-Blockchain-Ids": SOLANA_BLOCKCHAIN_ID,
  };
}

/** Preflight response shared by every Actions route. */
export function buildActionsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: buildActionHeaders() });
}
