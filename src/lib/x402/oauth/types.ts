import "server-only";

import type { Platform } from "@/lib/x402/connect/types";

/** Decoded connection token payload, verified via HMAC. */
export interface ConnectionTokenPayload {
  /** social_connections.id */
  connectionId: string;

  /** Wallet that initiated the connection. */
  walletAddress: string;

  /**
   * x402_charges.id for the upfront payment. Null for idempotent reconnects,
   * which charge nothing.
   */
  chargeId: string | null;

  /** Token issued at (ms since epoch). */
  iat: number;

  /** Token expires at (ms since epoch): connection expiry plus grace. */
  exp: number;

  /** OAuth platform. */
  platform: Platform;
}
