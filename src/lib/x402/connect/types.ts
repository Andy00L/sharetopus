import "server-only";

import type { NetworkConfig } from "@/lib/x402/networks";

/**
 * Platforms reachable through the x402 connect/reauth/callback flows. A
 * subset of the 8-platform DB union in database.types.ts; the canonical set
 * lives in X402_PLATFORMS in config.ts.
 */
export type Platform = "linkedin" | "tiktok" | "pinterest" | "instagram";

/** Result of a successful /connect call. */
export interface ConnectSuccessPayload {
  connectionId: string;
  platform: Platform;
  /** Null on idempotent reconnects: there is no new OAuth flow to run. */
  oauthUrl: string | null;
  /**
   * HMAC token for GET /api/x402/oauth/status. Null on reconnects whose
   * social_accounts row predates connection tracking (no social_connections
   * row exists to poll).
   */
  connectionToken: string | null;
  expiresAt: string;
  isReconnect: boolean;
}

export interface ConnectNetworkContext {
  network: NetworkConfig;
  recipientAddress: string;
  expectedDomain: string;
  resourceUrl: string;
  platform: Platform;
}
