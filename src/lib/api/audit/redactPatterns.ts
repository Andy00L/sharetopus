// Redaction shared by the MCP and REST audit logs. Keys are matched by name, case-insensitive.
const REDACT_KEYS =
  /^(token|password|secret|authorization|bearer|api_key|apikey|access_token|refresh_token|credential|private_key|jwt)$/i;

/** Max size of args_redacted, in characters. */
const MAX_ARGS_LENGTH = 4096;

/** Replaces secret-named keys and JWT-looking strings with markers, at any depth. */
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


function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return looksLikeJwt(value) ? "[REDACTED_JWT]" : value;
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value !== null && typeof value === "object") {
    return redactSecrets(Object.fromEntries(Object.entries(value)));
  }
  return value;
}

/** Rough JWT detector: three base64url segments separated by dots. */
function looksLikeJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

/** Truncate to MAX_ARGS_LENGTH chars. Returns the parsed-safe JSON object. */
export function truncateJson(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const str = JSON.stringify(obj);
  if (str.length <= MAX_ARGS_LENGTH) return obj;
  return { _truncated: true, _preview: str.slice(0, MAX_ARGS_LENGTH) };
}
