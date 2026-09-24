import "server-only";

/**
 * HTTP Basic header for confidential-client token calls (RFC 6749 section
 * 2.3.1). X and Pinterest authenticate the app this way on their token
 * endpoints, for both the code exchange and the refresh.
 */
export function buildBasicAuthHeader(
  clientId: string,
  clientSecret: string,
): string {
  const encodedCredentials = Buffer.from(
    `${clientId}:${clientSecret}`,
  ).toString("base64");
  return `Basic ${encodedCredentials}`;
}
