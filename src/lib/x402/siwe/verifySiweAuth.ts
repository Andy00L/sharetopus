import "server-only";

import { parseSiweMessage, verifySiweMessage } from "viem/siwe";
import { createPublicClient, http } from "viem";
import type { NetworkConfig } from "@/lib/x402/networks";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VerifySiweAuthInput {
  /** Raw SIWE message string (EIP-4361 format), from request body. */
  message: string;

  /** Hex signature, from request body. */
  signature: `0x${string}`;

  /** Expected payer address (from the payment payload authorization.from). */
  expectedAddress: `0x${string}`;

  /** Network the payment was sent on. SIWE message.chainId must match. */
  network: NetworkConfig;

  /** Expected SIWE message.domain (public site host, from config.ts). */
  expectedDomain: string;

  /**
   * Expected SIWE message.uri: the exact resource being purchased. Binds the
   * signed message to this endpoint so a SIWE message signed for any other
   * purpose on the same domain cannot authorize a registration.
   */
  expectedUri: string;
}

export type VerifySiweAuthResult =
  | { ok: true; parsedMessage: SiweMessageParsed }
  | { ok: false; error: VerifySiweAuthError };

export type VerifySiweAuthError =
  | { kind: "parse_failed"; message: string }
  | { kind: "domain_mismatch"; expected: string; received: string | undefined }
  | {
      kind: "address_mismatch";
      expected: string;
      received: string | undefined;
    }
  | { kind: "chain_mismatch"; expected: number; received: number | undefined }
  | { kind: "uri_mismatch"; expected: string; received: string | undefined }
  | { kind: "expired"; message: string }
  | { kind: "not_yet_valid"; message: string }
  | { kind: "invalid_signature"; message: string }
  | { kind: "verification_error"; message: string };

export interface SiweMessageParsed {
  address: `0x${string}`;
  domain: string;
  chainId: number;
  nonce: string;
  issuedAt: Date | undefined;
  expirationTime: Date | undefined;
}

// ---------------------------------------------------------------------------
// Module-scope client cache
// ---------------------------------------------------------------------------

/** Cache public clients by RPC URL to reuse transport connections. */
const publicClientCache = new Map<
  string,
  ReturnType<typeof createPublicClient>
>();

function getOrCreatePublicClient(
  rpcUrl: string
): ReturnType<typeof createPublicClient> {
  const cached = publicClientCache.get(rpcUrl);
  if (cached) return cached;
  const client = createPublicClient({ transport: http(rpcUrl) });
  publicClientCache.set(rpcUrl, client);
  return client;
}

// ---------------------------------------------------------------------------
// Main verification function
// ---------------------------------------------------------------------------

/**
 * Verifies a SIWE message + signature against expected fields.
 *
 * Two-step:
 *   1. Manual field checks (domain, address, chainId, uri, time) for
 *      specific error variants. Nonce single-use enforcement is NOT here:
 *      the caller extracts the message nonce and consumeSiweNonce proves it
 *      was server-issued, unused, and unexpired.
 *   2. verifySiweMessage: cryptographic signature verification via viem.
 *
 * For EOA signatures, verifySiweMessage runs locally (no RPC call). Smart
 * contract wallets (EIP-1271/ERC-6492) verify through the network's public
 * RPC from networks.ts; a viem publicClient is created per network and
 * cached at module scope.
 *
 * Called by: handleRegisterVerify
 * Never throws; all errors returned as typed variants.
 */
export async function verifySiweAuth(
  input: VerifySiweAuthInput
): Promise<VerifySiweAuthResult> {
  // Step 1: Parse the raw SIWE message string.
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(input.message);
  } catch (err) {
    console.error("[verifySiweAuth] Failed to parse SIWE message:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "parse_failed",
        message: err instanceof Error
          ? err.message
          : "Failed to parse SIWE message.",
      },
    };
  }

  // Step 2: Manual field checks for specific error variants.
  if (!parsed.domain || parsed.domain !== input.expectedDomain) {
    return {
      ok: false,
      error: {
        kind: "domain_mismatch",
        expected: input.expectedDomain,
        received: parsed.domain,
      },
    };
  }

  if (
    !parsed.address ||
    parsed.address.toLowerCase() !== input.expectedAddress.toLowerCase()
  ) {
    return {
      ok: false,
      error: {
        kind: "address_mismatch",
        expected: input.expectedAddress,
        received: parsed.address,
      },
    };
  }

  // SIWE is EVM-only; chainId must be a number.
  if (input.network.chainId === null) {
    return {
      ok: false,
      error: {
        kind: "chain_mismatch",
        expected: 0,
        received: parsed.chainId,
      },
    };
  }

  if (
    parsed.chainId === undefined ||
    parsed.chainId !== input.network.chainId
  ) {
    return {
      ok: false,
      error: {
        kind: "chain_mismatch",
        expected: input.network.chainId,
        received: parsed.chainId,
      },
    };
  }

  if (!parsed.uri || parsed.uri !== input.expectedUri) {
    return {
      ok: false,
      error: {
        kind: "uri_mismatch",
        expected: input.expectedUri,
        received: parsed.uri,
      },
    };
  }

  // Time-based checks using a single snapshot to avoid race conditions.
  const now = new Date();

  if (parsed.expirationTime && parsed.expirationTime < now) {
    return {
      ok: false,
      error: {
        kind: "expired",
        message: `SIWE message expired at ${parsed.expirationTime.toISOString()}.`,
      },
    };
  }

  if (parsed.notBefore && parsed.notBefore > now) {
    return {
      ok: false,
      error: {
        kind: "not_yet_valid",
        message: `SIWE message not valid until ${parsed.notBefore.toISOString()}.`,
      },
    };
  }

  // Step 3: Cryptographic signature verification via viem.
  // Field checks already passed above; pass time to keep the same snapshot.
  try {
    const client = getOrCreatePublicClient(input.network.rpcUrl);
    const isValid = await verifySiweMessage(client, {
      message: input.message,
      signature: input.signature,
      time: now,
    });

    if (!isValid) {
      return {
        ok: false,
        error: {
          kind: "invalid_signature",
          message: "SIWE signature verification failed.",
        },
      };
    }
  } catch (err) {
    console.error("[verifySiweAuth] Signature verification error:", err instanceof Error ? err.message : err);
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

  // All checks passed. parsed.nonce is non-empty here because the caller
  // already extracted it for consumeSiweNonce before invoking this function.
  return {
    ok: true,
    parsedMessage: {
      address: parsed.address as `0x${string}`,
      domain: parsed.domain,
      chainId: parsed.chainId,
      nonce: parsed.nonce ?? "",
      issuedAt: parsed.issuedAt,
      expirationTime: parsed.expirationTime,
    },
  };
}
