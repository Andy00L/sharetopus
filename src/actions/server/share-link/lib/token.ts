import "server-only";

import { randomBytes } from "node:crypto";

/**
 * Generates a cryptographically secure share link token.
 *
 * Uses 32 random bytes encoded as base64url, producing a 43-character
 * URL-safe string with 256 bits of entropy. Stronger than nanoid for
 * this security-sensitive use case (account delegation).
 *
 * Called by: createShareLink server action
 * No DB calls; pure token generation.
 */
export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}
