import "server-only";

import type { NetworkConfig } from "@/lib/x402/networks";

export type Platform = "linkedin" | "tiktok" | "pinterest" | "instagram";

/** Body of POST /api/x402/connect after X-PAYMENT is present. */
export interface ConnectVerifyBody {
  platform: Platform;
  /** Optional: where to redirect the user after OAuth completes (post-success page). */
  finalRedirectUrl?: string;
}

/** Result of a successful /connect call. */
export interface ConnectSuccessPayload {
  connectionId: string;
  platform: Platform;
  oauthUrl: string;
  connectionToken: string;
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
