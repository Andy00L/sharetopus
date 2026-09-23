import "server-only";

/**
 * Loads a signing key the operator holds for a self-signed lane: the Arc
 * operations key (settlement and refunds) and the Celo refund key.
 *
 * Errors as values: both callers map a failure to a facilitator or refund
 * error, and a bad key on one lane must not take down another network's
 * request path. The key itself is never logged, only whether it is absent
 * or malformed.
 *
 * Called by: arc/arcChain.ts, celo/refundCelo.ts
 * Env: X402_ARC_KEY, X402_CELO_REFUND_KEY
 */

import type { Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/** 32-byte hex private key, 0x prefix optional. */
const PRIVATE_KEY_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;

export type OperatorKeyEnvVar = "X402_ARC_KEY" | "X402_CELO_REFUND_KEY";

export type OperatorAccountResult =
  | { ok: true; account: PrivateKeyAccount }
  | { ok: false; message: string };

export function loadOperatorAccount(
  envVarName: OperatorKeyEnvVar,
): OperatorAccountResult {
  const rawKey = process.env[envVarName];
  if (!rawKey) {
    return { ok: false, message: `${envVarName} env var not set.` };
  }
  if (!PRIVATE_KEY_PATTERN.test(rawKey)) {
    return { ok: false, message: `${envVarName} is not a 32-byte hex key.` };
  }
  const hexDigits = rawKey.startsWith("0x") ? rawKey.slice(2) : rawKey;
  const normalizedKey: Hex = `0x${hexDigits}`;
  return { ok: true, account: privateKeyToAccount(normalizedKey) };
}
