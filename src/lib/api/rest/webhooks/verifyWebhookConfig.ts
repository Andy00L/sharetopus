import { isPrivateOrReservedIp } from "@/lib/net/ipBlocklist";
import { lookup } from "node:dns/promises";

const MAX_URL_LENGTH = 2048;

export type VerifyWebhookUrlResult =
  | { valid: true }
  | { valid: false; message: string };

export async function verifyWebhookUrl(
  url: string,
): Promise<VerifyWebhookUrlResult> {
  if (url.length > MAX_URL_LENGTH) {
    return { valid: false, message: "URL must be 2048 characters or fewer" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, message: "Invalid URL format" };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, message: "URL must use HTTPS" };
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    return { valid: false, message: "URL must have a hostname" };
  }

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  ) {
    return { valid: false, message: "Localhost URLs are not allowed" };
  }

  const resolvedAddresses = await lookupAddressesIfResolvable(hostname);
  if (resolvedAddresses.some(isPrivateOrReservedIp)) {
    return {
      valid: false,
      message: "URL resolves to a private or reserved IP address",
    };
  }

  return { valid: true };
}

async function lookupAddressesIfResolvable(hostname: string): Promise<string[]> {
  try {
    const lookupResult = await lookup(hostname, { all: true });
    return lookupResult.map((resolvedEntry) => resolvedEntry.address);
  } catch {
    return [];
  }
}
