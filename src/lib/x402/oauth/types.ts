import "server-only";

/** Decoded connection token payload, verified via HMAC. */
export interface ConnectionTokenPayload {
  /** social_connections.id */
  connectionId: string;

  /** Wallet that initiated the connection. */
  walletAddress: string;

  /** x402_charges.id for the upfront payment. */
  chargeId: string;

  /** Token issued at (ms since epoch). */
  iat: number;

  /** Token expires at (ms since epoch). Matches social_connections.expires_at + 1 hour grace. */
  exp: number;

  /** OAuth platform. */
  platform: "linkedin" | "tiktok" | "pinterest" | "instagram";
}
