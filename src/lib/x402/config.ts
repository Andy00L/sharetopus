import "server-only";

/**
 * Single source of truth for x402 environment configuration and shared
 * constants. Every env var the x402 surface reads (other than secrets owned
 * by a single module, like X402_HMAC_SECRET in oauth/connectionToken.ts and
 * the CDP_* vars consumed by the CDP SDK in facilitator.ts) is read exactly
 * once, here. Flow handlers and routes import these helpers instead of
 * touching process.env directly.
 *
 * Called by: facilitator.ts, x402PaidEndpoint, register/connect/reauth flows,
 *            route handlers under src/app/api/x402/
 * Tables touched: none (pure configuration)
 */

import type { NetworkConfig } from "@/lib/x402/networks";
import type { Platform } from "@/lib/x402/connect/types";

/** CDP hosted facilitator (mainnet; requires CDP API-key auth). */
export const DEFAULT_FACILITATOR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402";

/** Facilitator base URL: X402_FACILITATOR_URL overrides the CDP default. */
export function getFacilitatorUrl(): string {
  return process.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL;
}

/**
 * Identifier stored in x402_charges.facilitator. The DB column is free text;
 * short names are the domain vocabulary (full URLs were normalized out of
 * historical rows in June 2026).
 */
export const FACILITATOR_NAME = "coinbase_cdp";

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

/** Platforms purchasable through x402 connect/reauth. */
export const X402_PLATFORMS: ReadonlySet<Platform> = new Set<Platform>([
  "linkedin",
  "tiktok",
  "pinterest",
  "instagram",
]);

/** Type guard for query/body platform values against the x402 subset. */
export function isX402Platform(value: string): value is Platform {
  return X402_PLATFORMS.has(value as Platform);
}

/** Server Wallet receiving address for the network family. Null when unset. */
export function getRecipientAddress(network: NetworkConfig): string | null {
  const recipientAddress = network.isEvm
    ? process.env.X402_RECIPIENT_EVM
    : process.env.X402_RECIPIENT_SOLANA;
  return recipientAddress ?? null;
}

/** Public site origin used for resource URLs and SIWE domains. */
export function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
}

/** Browser-facing app origin for redirects from the OAuth callback pages. */
export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? getBaseUrl();
}

/** SIWE expected domain: the bare host of the public site origin. */
export function getExpectedDomain(): string {
  return new URL(getBaseUrl()).host;
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
  }
}
