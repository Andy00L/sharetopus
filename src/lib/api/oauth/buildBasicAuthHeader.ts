import "server-only";

export function buildBasicAuthHeader(
  clientId: string,
  clientSecret: string,
): string {
  const encodedCredentials = Buffer.from(
    `${clientId}:${clientSecret}`,
  ).toString("base64");
  return `Basic ${encodedCredentials}`;
}
