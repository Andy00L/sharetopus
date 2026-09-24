import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Application-level encryption for the OAuth tokens and API credentials in
 * social_accounts (AES-256-GCM). A database dump, a leaked service-role
 * key or an SQL injection then yields ciphertext only: the key lives in
 * the SOCIAL_TOKEN_ENCRYPTION_KEY env var (32 random bytes, base64), never
 * in the database.
 *
 * Stored format: "enc:v1:<iv>:<ciphertext>:<auth tag>", each part base64url.
 * The version tag lets a future key rotation tell old values from new ones.
 *
 * Errors are thrown, not returned: these functions run inside Drizzle's
 * column mapping (src/db/schema.ts, encryptedText), which is synchronous
 * and has no error channel. The query then throws and runQuery turns it
 * into an error value, so a missing key or a tampered value fails the
 * query instead of storing or returning a wrong token.
 *
 * No "server-only" import: drizzle-kit loads src/db/schema.ts outside
 * Next.js. Nothing runs at import time; the key is read on each call.
 */

export const ENCRYPTED_TOKEN_PREFIX = "enc:v1:";

/** AES-256 takes a 32-byte key. */
const KEY_BYTES = 32;
/** 96-bit IV, the size GCM is specified for (NIST SP 800-38D). */
const IV_BYTES = 12;
/** GCM authentication tag length, in bytes. */
const AUTH_TAG_BYTES = 16;
const CIPHER_ALGORITHM = "aes-256-gcm";

function readEncryptionKey(): Buffer {
  const encodedKey = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY;
  if (!encodedKey) {
    throw new Error("[readEncryptionKey] SOCIAL_TOKEN_ENCRYPTION_KEY is not set.");
  }
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `[readEncryptionKey] SOCIAL_TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes.`,
    );
  }
  return key;
}

/** True when the stored value was written by encryptToken. */
export function isEncryptedToken(storedValue: string): boolean {
  return storedValue.startsWith(ENCRYPTED_TOKEN_PREFIX);
}

/** Encrypts a token for storage. Every call uses a fresh random IV. */
export function encryptToken(plaintext: string): string {
  const initializationVector = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER_ALGORITHM, readEncryptionKey(), initializationVector, {
    authTagLength: AUTH_TAG_BYTES,
  });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    ENCRYPTED_TOKEN_PREFIX + initializationVector.toString("base64url"),
    ciphertext.toString("base64url"),
    authTag.toString("base64url"),
  ].join(":");
}

/**
 * Decrypts a stored token. A value without the prefix was written before
 * encryption shipped and is returned unchanged; the encrypt-social-tokens
 * cron rewrites those rows.
 */
export function decryptToken(storedValue: string): string {
  if (!isEncryptedToken(storedValue)) return storedValue;
  const [encodedIv, encodedCiphertext, encodedAuthTag, ...extraParts] = storedValue
    .slice(ENCRYPTED_TOKEN_PREFIX.length)
    .split(":");
  if (!encodedIv || encodedCiphertext === undefined || !encodedAuthTag || extraParts.length > 0) {
    throw new Error("[decryptToken] Stored token is not in the enc:v1 format.");
  }
  const decipher = createDecipheriv(
    CIPHER_ALGORITHM,
    readEncryptionKey(),
    Buffer.from(encodedIv, "base64url"),
    { authTagLength: AUTH_TAG_BYTES },
  );
  decipher.setAuthTag(Buffer.from(encodedAuthTag, "base64url"));
  // final() throws when the tag does not match: a wrong key or a tampered value.
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
