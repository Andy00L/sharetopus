import "server-only";

import type { Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

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
