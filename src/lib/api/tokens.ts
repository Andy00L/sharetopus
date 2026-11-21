import "server-only";

import { randomBytes, createHash } from "node:crypto";

import type { API_KEY_KINDS } from "@/db/schema";

export type ApiKeyKind = Exclude<(typeof API_KEY_KINDS)[number], "wallet">;

const TOKEN_RANDOM_BYTES = 32;
const PREFIX_DISPLAY_LENGTH = 16;

export function generateApiKey(kind: ApiKeyKind): {
  rawKey: string;
  prefix: string;
  tokenHash: string;
} {
  const randomHexSegment = randomBytes(TOKEN_RANDOM_BYTES).toString("hex");
  const rawKey = `stp_${kind}_${randomHexSegment}`;
  const prefix = rawKey.slice(0, `stp_${kind}_`.length + PREFIX_DISPLAY_LENGTH);
  const tokenHash = hashToken(rawKey);

  return { rawKey, prefix, tokenHash };
}

export function hashToken(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function isApiKeyToken(token: string, kind: ApiKeyKind): boolean {
  return token.startsWith(`stp_${kind}_`);
}
