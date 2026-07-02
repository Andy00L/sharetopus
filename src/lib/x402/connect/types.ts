import "server-only";

import type { PostingPlatform } from "@/lib/platforms/capabilities";
import type { NetworkConfig } from "@/lib/x402/networks";

/**
 * Platforms reachable through the x402 connect/reauth/callback flows.
 * Every posting platform has an x402 OAuth flow, so this aliases the
 * shared registry (src/lib/platforms/capabilities.ts); the runtime set
 * lives in X402_PLATFORMS in config.ts.
 */
export type Platform = PostingPlatform;

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
  resourceUrl: string;
  platform: Platform;
}
