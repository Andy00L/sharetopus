import "server-only";

import { randomBytes } from "node:crypto";

const SHARE_TOKEN_BYTES = 32;
// base64url without padding carries 6 bits per character (RFC 4648 section 5).
const BASE64URL_BITS_PER_CHAR = 6;
const SHARE_TOKEN_LENGTH_CHARS = Math.ceil((SHARE_TOKEN_BYTES * 8) / BASE64URL_BITS_PER_CHAR);
const SHARE_TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${SHARE_TOKEN_LENGTH_CHARS}}$`);

export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

export function isShareTokenFormat(token: string): boolean {
  return SHARE_TOKEN_PATTERN.test(token);
}
