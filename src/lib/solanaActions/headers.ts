import "server-only";

import { NETWORKS } from "@/lib/x402/networks";

const SOLANA_ACTIONS_SPEC_VERSION = "2.4.2";

const SOLANA_BLOCKCHAIN_ID = NETWORKS.solana.caipNetwork;

// The Solana Actions spec requires these CORS headers on every Actions route (@solana/actions ACTIONS_CORS_HEADERS, actions-spec v2.4.2).
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

export function buildActionsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: buildActionHeaders() });
}
