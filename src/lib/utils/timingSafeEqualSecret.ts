import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time equality for two secret strings of arbitrary length.
 *
 * `node:crypto.timingSafeEqual` throws when the two buffers differ in
 * length, and comparing raw secret bytes would leak the expected length
 * through that throw. Hashing both sides to a fixed 32 bytes first makes
 * every comparison the same width, so neither the length nor the position
 * of the first differing character is observable through timing.
 *
 * Use for shared-secret checks (cron keys, bypass tokens). HMAC digests
 * that are already fixed-width can call timingSafeEqual directly.
 *
 * Called by: authCheckCronJob, checkRateLimit (bypass secret).
 * Tables touched: none.
 */
export function timingSafeEqualSecret(
  candidate: string,
  expected: string,
): boolean {
  const candidateDigest = createHash("sha256").update(candidate).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}
