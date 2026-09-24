/** Parses a token endpoint body; anything that is not JSON reads as null. */
export function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The RFC 6749 "error" code, when the body carries one as a string. */
export function readOAuthError(body: unknown): string | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return null;
}
