import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { POSTING_PLATFORMS } from "@/lib/platforms/capabilities";
import type { ConnectionTokenPayload } from "./types";

const TOKEN_VERSION = "v1";

/**
 * Shape check for the decoded payload. The HMAC already proves we issued
 * the token, so this is defense in depth: it keeps a malformed or legacy
 * payload (e.g. one missing exp) from slipping past the expiry check, and
 * keeps verifyConnectionToken true to its never-throws contract when the
 * JSON decodes to null or a non-object.
 */
const ConnectionTokenPayloadSchema = z.object({
  connectionId: z.string().min(1),
  walletAddress: z.string().min(1),
  chargeId: z.string().nullable(),
  iat: z.number(),
  exp: z.number(),
  platform: z.enum(POSTING_PLATFORMS),
});

export type IssueConnectionTokenResult =
  | { ok: true; token: string }
  | { ok: false; error: "missing_secret"; message: string };

export type VerifyConnectionTokenResult =
  | { ok: true; payload: ConnectionTokenPayload }
  | {
      ok: false;
      error: "malformed" | "invalid_signature" | "expired" | "missing_secret";
      message: string;
    };

function getHmacSecret(): string | null {
  return process.env.X402_HMAC_SECRET ?? null;
}

/**
 * True when X402_HMAC_SECRET is configured. Flows that charge before
 * issuing a token call this first so a missing secret fails the request
 * before any money moves.
 */
export function hasConnectionTokenSecret(): boolean {
  return getHmacSecret() !== null;
}

function computeHmac(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

/**
 * Issues an HMAC-signed token at /connect. Agent presents this at /status as Bearer.
 *
 * Format: v1.<base64url(payload)>.<base64url(hmac)>
 * HMAC: SHA-256 over "v1.<base64url(payload)>" with X402_HMAC_SECRET.
 *
 * Stateless: no DB row needed for verification. Faster than DB lookup (~1ms vs 30ms).
 * Trade-off: cannot revoke individual tokens before expiry. Acceptable because /status
 * also reads social_connections.status from DB and returns the current state.
 */
export function issueConnectionToken(
  payload: ConnectionTokenPayload
): IssueConnectionTokenResult {
  const secret = getHmacSecret();
  if (!secret) {
    console.error("[issueConnectionToken] X402_HMAC_SECRET env var not set.");
    return {
      ok: false,
      error: "missing_secret",
      message: "X402_HMAC_SECRET is not configured.",
    };
  }

  const payloadJson = JSON.stringify(payload);
  const encodedPayload = Buffer.from(payloadJson).toString("base64url");
  const signingInput = `${TOKEN_VERSION}.${encodedPayload}`;
  const hmac = computeHmac(signingInput, secret);

  return { ok: true, token: `${signingInput}.${hmac}` };
}

/**
 * Verifies an HMAC-signed token from a /status request.
 *
 * Uses timingSafeEqual to prevent timing attacks, validates the decoded
 * payload shape, and checks expiry (exp > now).
 *
 * Errors-as-values; never throws.
 */
export function verifyConnectionToken(
  token: string
): VerifyConnectionTokenResult {
  const secret = getHmacSecret();
  if (!secret) {
    console.error("[verifyConnectionToken] X402_HMAC_SECRET env var not set.");
    return {
      ok: false,
      error: "missing_secret",
      message: "X402_HMAC_SECRET is not configured.",
    };
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return {
      ok: false,
      error: "malformed",
      message: "Token format is invalid. Expected v1.<payload>.<hmac>.",
    };
  }

  const [version, encodedPayload, receivedHmac] = parts;
  const signingInput = `${version}.${encodedPayload}`;
  const expectedHmac = computeHmac(signingInput, secret);

  // Timing-safe comparison
  const receivedBuf = Buffer.from(receivedHmac, "base64url");
  const expectedBuf = Buffer.from(expectedHmac, "base64url");

  if (
    receivedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(receivedBuf, expectedBuf)
  ) {
    return {
      ok: false,
      error: "invalid_signature",
      message: "Token signature verification failed.",
    };
  }

  // Decode and shape-check the payload
  let decodedPayload: unknown;
  try {
    decodedPayload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf-8")
    );
  } catch {
    return {
      ok: false,
      error: "malformed",
      message: "Token payload is not valid JSON.",
    };
  }

  const parsedPayload = ConnectionTokenPayloadSchema.safeParse(decodedPayload);
  if (!parsedPayload.success) {
    return {
      ok: false,
      error: "malformed",
      message: "Token payload has an unexpected shape.",
    };
  }

  // Check expiry
  if (parsedPayload.data.exp <= Date.now()) {
    return {
      ok: false,
      error: "expired",
      message: "Connection token has expired.",
    };
  }

  return { ok: true, payload: parsedPayload.data };
}
