import "server-only";

/**
 * Single source of truth for x402 environment configuration and shared
 * constants. Every env var the x402 surface reads is read here, except the
 * secrets owned by one module: X402_HMAC_SECRET (oauth/connectionToken.ts),
 * the CDP_* vars (cdp/cdpClient.ts), X402_CELO_FACILITATOR_API_KEY
 * (facilitatorClient.ts), X402_CELO_REFUND_KEY and X402_CELO_ATTRIBUTION_TAG
 * (celo/refundCelo.ts), X402_ARC_KEY (arc/arcChain.ts) and
 * X402_FACILITATOR_SETTLE_KEY (arc/facilitatorApi.ts). Per-network payout
 * wallets and RPC overrides are named by the registry entry (networks.ts)
 * and resolved here.
 *
 * Called by: facilitator.ts, facilitatorClient.ts, the paid middleware,
 *            connect/reauth flows, route handlers under src/app/api/x402/
 * Tables touched: none (pure configuration)
 */

import { POSTING_PLATFORMS } from "@/lib/platforms/capabilities";
import type { NetworkConfig } from "@/lib/x402/networks";
import type { Platform } from "@/lib/x402/connect/types";

/** CDP hosted facilitator (mainnet; requires CDP API-key auth). */
export const DEFAULT_FACILITATOR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402";

/**
 * Celo hosted facilitator JSON API. The x402.celo.org root serves the SPA;
 * the API lives on the api. subdomain (probed live 2026-07-16: GET
 * /supported returns the exact-scheme kind for eip155:42220).
 * sourceRef: docs.celo.org/build-on-celo/build-with-ai/x402
 */
export const DEFAULT_CELO_FACILITATOR_URL = "https://api.x402.celo.org";

/**
 * Base URL of a hosted facilitator lane. X402_CELO_FACILITATOR_URL and
 * X402_FACILITATOR_URL override the defaults. The arc_local lane has no URL:
 * it settles in process (arc/arcFacilitator.ts).
 */
export function getHostedFacilitatorUrl(lane: "coinbase_cdp" | "celo"): string {
  if (lane === "celo") {
    return process.env.X402_CELO_FACILITATOR_URL || DEFAULT_CELO_FACILITATOR_URL;
  }
  return process.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL;
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
export const X402_PLATFORMS: ReadonlySet<string> = new Set<string>(
  POSTING_PLATFORMS,
);

/** Type guard for query/body platform values against the x402 subset. */
export function isX402Platform(value: string): value is Platform {
  return X402_PLATFORMS.has(value);
}

/**
 * Payout (payTo) address for a network, which is also the refund sender.
 * The registry names the variable per network, so Celo and Arc never fall
 * back to the shared CDP EVM wallet: their refunds are signed with keys the
 * operator holds. Null when unset (callers fail closed).
 */
export function getRecipientAddress(network: NetworkConfig): string | null {
  const recipientAddress = process.env[network.recipientEnvVar];
  return recipientAddress ? recipientAddress : null;
}

/**
 * JSON-RPC endpoint for a network: the registry's public endpoint unless the
 * entry names an override variable and it holds a valid https URL.
 *
 * A missing or malformed override falls back to the public endpoint with a
 * warning rather than failing closed: a rate-limited read beats no read on
 * a refund. The configured URL is never logged, because provider endpoints
 * usually carry their API key in the path or query string. Only Solana warns
 * when the override is unset, since its public endpoint sheds load.
 */
export function getRpcUrl(network: NetworkConfig): string {
  const overrideVar = network.rpcUrlEnvVar;
  if (!overrideVar) return network.rpcUrl;

  const configuredRpcUrl = process.env[overrideVar];
  if (!configuredRpcUrl) {
    if (network.family === "svm") {
      console.warn(
        `[getRpcUrl] ${overrideVar} is not set. Falling back to the rate-limited public ${network.displayName} endpoint.`,
      );
    }
    return network.rpcUrl;
  }

  let parsedRpcUrl: URL;
  try {
    parsedRpcUrl = new URL(configuredRpcUrl);
  } catch {
    console.warn(
      `[getRpcUrl] ${overrideVar} is not a parseable URL. Falling back to the public ${network.displayName} endpoint.`,
    );
    return network.rpcUrl;
  }

  if (parsedRpcUrl.protocol !== "https:") {
    console.warn(
      `[getRpcUrl] ${overrideVar} must use https (got "${parsedRpcUrl.protocol}"). Falling back to the public ${network.displayName} endpoint.`,
    );
    return network.rpcUrl;
  }

  return configuredRpcUrl;
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
