import "server-only";

/**
 * Single source of truth for x402 environment configuration and shared
 * constants. Every env var the x402 surface reads (other than secrets owned
 * by a single module: X402_HMAC_SECRET in oauth/connectionToken.ts, the
 * CDP_* vars consumed by the CDP SDK in facilitator.ts,
 * X402_CELO_FACILITATOR_API_KEY in facilitatorClient.ts, and
 * X402_CELO_REFUND_KEY / X402_CELO_ATTRIBUTION_TAG in celo/refundCelo.ts)
 * is read exactly once, here. Flow handlers and routes import these helpers
 * instead of touching process.env directly.
 *
 * Called by: facilitator.ts, x402PaidEndpoint, connect/reauth flows,
 *            route handlers under src/app/api/x402/
 * Tables touched: none (pure configuration)
 */

import { POSTING_PLATFORMS } from "@/lib/platforms/capabilities";
import type { NetworkConfig } from "@/lib/x402/networks";
import type { Platform } from "@/lib/x402/connect/types";

/** CDP hosted facilitator (mainnet; requires CDP API-key auth). */
export const DEFAULT_FACILITATOR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402";

/**
 * Celo self-hosted facilitator JSON API. The x402.celo.org root serves the
 * SPA; the API lives on the api. subdomain (probed live 2026-07-16:
 * GET /supported returns the exact-scheme kind for eip155:42220).
 * sourceRef: docs.celo.org/build-on-celo/build-with-ai/x402
 */
export const DEFAULT_CELO_FACILITATOR_URL = "https://api.x402.celo.org";

/**
 * Facilitator base URL for a network. Celo settles through the Celo
 * facilitator (env X402_CELO_FACILITATOR_URL overrides); every other
 * network keeps the CDP default (env X402_FACILITATOR_URL overrides).
 */
export function getFacilitatorUrl(network: NetworkConfig): string {
  if (network.name === "celo") {
    return process.env.X402_CELO_FACILITATOR_URL || DEFAULT_CELO_FACILITATOR_URL;
  }
  return process.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL;
}

/**
 * Identifier stored in x402_charges.facilitator, per network. The DB column
 * is free text; short names are the domain vocabulary (full URLs were
 * normalized out of historical rows in June 2026).
 */
export function getFacilitatorName(networkName: string): string {
  return networkName === "celo" ? "celo" : "coinbase_cdp";
}

/** How long an x402-initiated OAuth connection stays claimable. */
export const OAUTH_EXPIRY_MINUTES = 15;

/** Grace period added to connection-token expiry beyond the OAuth window. */
export const CONNECTION_TOKEN_GRACE_MS = 60 * 60 * 1000;

/**
 * Hard cap on /oauth/status polls per connection. A connection is claimable
 * for 15 minutes and the per-IP rate limit allows 120 polls/min, so 720
 * covers any legitimate polling cadence with margin (Drew decision, 2026-06).
 */
export const MAX_POLLS_PER_CONNECTION = 720;

/** Platforms purchasable through x402 connect/reauth (shared registry). */
export const X402_PLATFORMS: ReadonlySet<Platform> = new Set<Platform>(
  POSTING_PLATFORMS,
);

/** Type guard for query/body platform values against the x402 subset. */
export function isX402Platform(value: string): value is Platform {
  return X402_PLATFORMS.has(value as Platform);
}

/**
 * Receiving address for the network family. Null when unset (fail closed).
 * Celo has its own dedicated wallet (key held outside CDP; it doubles as
 * the refund sender in celo/refundCelo.ts), so it never falls back to
 * X402_RECIPIENT_EVM: refunds must come from a key the operator holds.
 */
export function getRecipientAddress(network: NetworkConfig): string | null {
  if (network.name === "celo") {
    return process.env.X402_RECIPIENT_CELO ?? null;
  }
  const recipientAddress = network.isEvm
    ? process.env.X402_RECIPIENT_EVM
    : process.env.X402_RECIPIENT_SOLANA;
  return recipientAddress ?? null;
}

/** Public site origin used for resource URLs. */
export function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
}

/** Browser-facing app origin for redirects from the OAuth callback pages. */
export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? getBaseUrl();
}

/** Per-platform OAuth redirect URI for the x402 callback flow. Null when unset. */
export function getOAuthRedirectUri(platform: Platform): string | null {
  switch (platform) {
    case "linkedin":
      return process.env.X402_LINKEDIN_REDIRECT_URI ?? null;
    case "tiktok":
      return process.env.X402_TIKTOK_REDIRECT_URI ?? null;
    case "pinterest":
      return process.env.X402_PINTEREST_REDIRECT_URI ?? null;
    case "instagram":
      return process.env.X402_INSTAGRAM_REDIRECT_URI ?? null;
    case "youtube":
      return process.env.X402_YOUTUBE_REDIRECT_URI ?? null;
    case "x":
      return process.env.X402_X_REDIRECT_URI ?? null;
    case "facebook":
      return process.env.X402_FACEBOOK_REDIRECT_URI ?? null;
  }
}
