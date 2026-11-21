import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { POSTING_PLATFORMS } from "@/lib/platforms/capabilities";
import type { ConnectionTokenPayload } from "./types";

const TOKEN_VERSION = "v1";

const ConnectionTokenPayloadSchema = z.object({
  connectionId: z.string().min(1),
  walletAddress: z.string().min(1),
  chargeId: z.string().nullable(),
  iat: z.number(),
  exp: z.number(),
  platform: z.enum(POSTING_PLATFORMS),
});

export type ConnectionTokenSecretResult =
  | { ok: true; secret: string }
  | { ok: false; message: string };

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

export function loadConnectionTokenSecret(): ConnectionTokenSecretResult {
  const secret = getHmacSecret();
  if (!secret) {
    console.error("[loadConnectionTokenSecret] X402_HMAC_SECRET env var not set.");
    return { ok: false, message: "X402_HMAC_SECRET is not configured." };
  }
  return { ok: true, secret };
}

function computeHmac(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function issueConnectionToken(secret: string, payload: ConnectionTokenPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${TOKEN_VERSION}.${encodedPayload}`;
  return `${signingInput}.${computeHmac(signingInput, secret)}`;
}

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

  if (parsedPayload.data.exp <= Date.now()) {
    return {
      ok: false,
      error: "expired",
      message: "Connection token has expired.",
    };
  }

  return { ok: true, payload: parsedPayload.data };
}
