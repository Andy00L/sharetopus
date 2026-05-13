import "server-only";

/**
 * Verify a Solana SIWS (Sign-In With Solana) message + signature.
 *
 * Message format (EIP-4361-inspired, adapted for Solana):
 *   <domain> wants you to sign in with your Solana account:
 *   <base58 pubkey>
 *
 *   <statement>
 *
 *   URI: <uri>
 *   Version: 1
 *   Chain ID: <chain identifier>
 *   Nonce: <nonce>
 *   Issued At: <ISO datetime>
 *   Expiration Time: <ISO datetime>
 *
 * Verification: Ed25519 signature check via @solana/keys (re-exported from @solana/kit).
 */

import {
  verifySignature,
  signatureBytes as toSignatureBytes,
} from "@solana/keys";
import bs58 from "bs58";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VerifySolanaSiweAuthInput {
  /** SIWS-format message (plain text). */
  message: string;
  /** Base58-encoded Ed25519 signature. */
  signature: string;
  /** Expected payer address (base58 Solana public key). */
  expectedAddress: string;
  /** Expected nonce. */
  expectedNonce: string;
  /** Expected domain (host only). */
  expectedDomain: string;
}

export type VerifySolanaSiweAuthResult =
  | { ok: true; parsedMessage: SolanaSiweMessageParsed }
  | { ok: false; error: VerifySolanaSiweAuthError };

export interface SolanaSiweMessageParsed {
  address: string;
  domain: string;
  nonce: string;
  issuedAt: Date | undefined;
  expirationTime: Date | undefined;
}

export type VerifySolanaSiweAuthError =
  | { kind: "parse_failed"; message: string }
  | { kind: "domain_mismatch"; expected: string; received: string | undefined }
  | { kind: "address_mismatch"; expected: string; received: string | undefined }
  | { kind: "nonce_mismatch"; expected: string; received: string | undefined }
  | { kind: "expired"; message: string }
  | { kind: "invalid_signature"; message: string }
  | { kind: "verification_error"; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function verifySolanaSiweAuth(
  input: VerifySolanaSiweAuthInput
): Promise<VerifySolanaSiweAuthResult> {
  // -- 1. Parse the SIWS message
  let parsed: SolanaSiweMessageParsed;
  try {
    parsed = parseSiwsMessage(input.message);
  } catch (err) {
    console.error("[verifySolanaSiweAuth] Parse failed:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "parse_failed",
        message: err instanceof Error ? err.message : "Failed to parse SIWS message.",
      },
    };
  }

  // -- 2. Field checks
  if (parsed.domain !== input.expectedDomain) {
    return {
      ok: false,
      error: {
        kind: "domain_mismatch",
        expected: input.expectedDomain,
        received: parsed.domain,
      },
    };
  }

  if (parsed.address !== input.expectedAddress) {
    return {
      ok: false,
      error: {
        kind: "address_mismatch",
        expected: input.expectedAddress,
        received: parsed.address,
      },
    };
  }

  if (parsed.nonce !== input.expectedNonce) {
    return {
      ok: false,
      error: {
        kind: "nonce_mismatch",
        expected: input.expectedNonce,
        received: parsed.nonce,
      },
    };
  }

  const now = new Date();
  if (parsed.expirationTime && parsed.expirationTime < now) {
    return {
      ok: false,
      error: {
        kind: "expired",
        message: `SIWS message expired at ${parsed.expirationTime.toISOString()}.`,
      },
    };
  }

  // -- 3. Ed25519 signature verification via @solana/keys
  try {
    // Decode the base58 public key to raw bytes, then import as CryptoKey.
    // Copy into a fresh ArrayBuffer to satisfy TypeScript's BufferSource constraint.
    const pubKeyRaw = bs58.decode(input.expectedAddress);
    const pubKeyBuffer = new ArrayBuffer(pubKeyRaw.length);
    new Uint8Array(pubKeyBuffer).set(pubKeyRaw);
    const publicKey = await crypto.subtle.importKey(
      "raw",
      pubKeyBuffer,
      { name: "Ed25519" },
      false,
      ["verify"]
    );

    // Decode the base58 signature
    const sigRaw = bs58.decode(input.signature);
    const sig = toSignatureBytes(new Uint8Array(sigRaw.buffer, sigRaw.byteOffset, sigRaw.byteLength));

    // Message bytes (UTF-8 encoding of the raw message text)
    const messageBytes = new TextEncoder().encode(input.message);

    const isValid = await verifySignature(publicKey, sig, messageBytes);

    if (!isValid) {
      return {
        ok: false,
        error: {
          kind: "invalid_signature",
          message: "SIWS signature verification failed.",
        },
      };
    }
  } catch (err) {
    console.error("[verifySolanaSiweAuth] Signature verification error:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "verification_error",
        message: err instanceof Error
          ? err.message
          : "Signature verification threw unexpectedly.",
      },
    };
  }

  return { ok: true, parsedMessage: parsed };
}

// ---------------------------------------------------------------------------
// SIWS message parser
// ---------------------------------------------------------------------------

function parseSiwsMessage(message: string): SolanaSiweMessageParsed {
  const lines = message.split("\n");

  // Line 0: "<domain> wants you to sign in with your Solana account:"
  const headerMatch = lines[0]?.match(
    /^(.+?) wants you to sign in with your Solana account:$/
  );
  if (!headerMatch) {
    throw new Error("Invalid SIWS header line.");
  }
  const domain = headerMatch[1];

  // Line 1: base58 address
  const address = lines[1]?.trim();
  if (!address) {
    throw new Error("Missing address in SIWS message.");
  }

  // Extract fields from remaining lines
  let nonce: string | undefined;
  let issuedAt: Date | undefined;
  let expirationTime: Date | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("Nonce: ")) {
      nonce = trimmed.slice(7);
    } else if (trimmed.startsWith("Issued At: ")) {
      issuedAt = new Date(trimmed.slice(11));
    } else if (trimmed.startsWith("Expiration Time: ")) {
      expirationTime = new Date(trimmed.slice(17));
    }
  }

  if (!nonce) {
    throw new Error("Missing Nonce in SIWS message.");
  }

  return { address, domain, nonce, issuedAt, expirationTime };
}
