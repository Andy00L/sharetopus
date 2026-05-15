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
 * like a JWT (three dot-separated base64 segments).
 */
export function redactSecrets(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACT_KEYS.test(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "string" && looksLikeJwt(value)) {
      result[key] = "[REDACTED_JWT]";
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      result[key] = redactSecrets(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
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
