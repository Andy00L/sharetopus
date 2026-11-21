import "server-only";

import type { PostingPlatform } from "@/lib/platforms/capabilities";
import type { NetworkConfig } from "@/lib/x402/networks";
import type { Platform } from "@/lib/x402/connect/types";

export const DEFAULT_FACILITATOR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402";

// x402.celo.org serves the dashboard; the facilitator API is the api. host (docs.celo.org/build-on-celo/build-with-ai/x402).
export const DEFAULT_CELO_FACILITATOR_URL = "https://api.x402.celo.org";

export function getHostedFacilitatorUrl(lane: "coinbase_cdp" | "celo"): string {
  if (lane === "celo") {
    return process.env.X402_CELO_FACILITATOR_URL || DEFAULT_CELO_FACILITATOR_URL;
  }
  return process.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL;
}

export const OAUTH_EXPIRY_MINUTES = 15;

export const CONNECTION_TOKEN_GRACE_MS = 60 * 60 * 1000;

export const MAX_POLLS_PER_CONNECTION = 720;

export const X402_PLATFORMS = [
  "linkedin",
  "tiktok",
  "pinterest",
] as const satisfies readonly PostingPlatform[];

export type X402Platform = (typeof X402_PLATFORMS)[number];

export function isX402Platform(value: string): value is X402Platform {
  return X402_PLATFORMS.some((platform) => platform === value);
}

export function getRecipientAddress(network: NetworkConfig): string | null {
  const recipientAddress = process.env[network.recipientEnvVar];
  return recipientAddress ? recipientAddress : null;
}

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

export function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
}

export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? getBaseUrl();
}

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
