/**
 * Shared redaction patterns for audit logging. Used by both MCP and REST
 * audit pipelines. Extracted verbatim from src/lib/mcp/audit.ts to avoid
 * duplication.
 */

/**
 * Fields that get scrubbed from tool arguments before persisting.
 *
 * Anything that smells like a secret or credential. We match on key
 * names (case-insensitive) rather than values, because values are
 * unpredictable.
 *
 * List: token, password, secret, authorization, bearer, api_key,
 * apikey, access_token, refresh_token, credential, private_key, jwt
 */
export const REDACT_KEYS =
  /^(token|password|secret|authorization|bearer|api_key|apikey|access_token|refresh_token|credential|private_key|jwt)$/i;

/** Max size (in chars) for args_redacted. Anything longer gets truncated. */
export const MAX_ARGS_LENGTH = 4096;

/**
 * Recursively walks an object and replaces values whose keys match
 * REDACT_KEYS with "[REDACTED]". Also catches anything that looks
 * like a JWT (three dot-separated base64 segments). Handles arrays
 * at any nesting depth.
 */
export function redactSecrets(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACT_KEYS.test(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = redactValue(value);
    }
  }
  return result;
}

/**
 * Apply redaction to any value recursively.
 *
 * - String: check for JWT pattern
 * - Plain object: recurse via redactSecrets (key-based redaction)
 * - Array: map redactValue over every element
 * - null / undefined / other primitives: pass through unchanged
 */
function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return looksLikeJwt(value) ? "[REDACTED_JWT]" : value;
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value !== null && typeof value === "object") {
    return redactSecrets(value as Record<string, unknown>);
  }
  return value;
}

/** Rough JWT detector: three base64url segments separated by dots. */
export function looksLikeJwt(s: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s);
}

/** Truncate to MAX_ARGS_LENGTH chars. Returns the parsed-safe JSON object. */
export function truncateJson(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const str = JSON.stringify(obj);
  if (str.length <= MAX_ARGS_LENGTH) return obj;
  return { _truncated: true, _preview: str.slice(0, MAX_ARGS_LENGTH) };
}
