import "server-only";

import { isIP } from "node:net";

/**
 * Private / reserved IP-range blocklist for SSRF defense. Single source of
 * truth shared by every server-side path that resolves a user-supplied
 * host (media download, webhook delivery). Extracted from
 * src/lib/mcp/_shared/safeUserFetch.ts so the media and webhook surfaces
 * validate identically.
 */

/**
 * Returns true if the IPv4 address (dotted-decimal) falls in any
 * private, reserved, loopback, link-local, CGNAT, multicast, or
 * broadcast range.
 */
function isPrivateIpv4(addr: string): boolean {
  const parts = addr.split(".");
  const a = Number(parts[0]);
  const b = Number(parts[1]);

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && (b & 0xc0) === 64) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a >= 224 && a <= 239) return true; // 224.0.0.0/4 (multicast)
  if (a >= 240) return true; // 240.0.0.0/4 (reserved + broadcast)
  return false;
}

/**
 * Parse an IPv6 address string into a 16-byte Uint8Array.
 * Handles :: expansion and embedded IPv4 suffixes (::ffff:1.2.3.4).
 */
function parseIpv6ToBytes(raw: string): Uint8Array {
  const bytes = new Uint8Array(16);
  let addr = raw;
  let targetGroups = 8;
  let ipv4Bytes: number[] | null = null;

  if (addr.includes(".")) {
    const lastColon = addr.lastIndexOf(":");
    const ipv4Str = addr.substring(lastColon + 1);
    ipv4Bytes = ipv4Str.split(".").map(Number);
    addr = addr.substring(0, lastColon);
    targetGroups = 6;
    if (addr.endsWith(":") && !addr.endsWith("::")) {
      addr = addr.slice(0, -1);
    }
  }

  const halves = addr.split("::");
  const leftTokens = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const rightTokens =
    halves.length > 1 && halves[1] ? halves[1].split(":").filter(Boolean) : [];

  let offset = 0;
  for (const token of leftTokens) {
    const val = parseInt(token, 16);
    bytes[offset] = (val >> 8) & 0xff;
    bytes[offset + 1] = val & 0xff;
    offset += 2;
  }

  const zerosNeeded = targetGroups - leftTokens.length - rightTokens.length;
  offset += zerosNeeded * 2;

  for (const token of rightTokens) {
    const val = parseInt(token, 16);
    bytes[offset] = (val >> 8) & 0xff;
    bytes[offset + 1] = val & 0xff;
    offset += 2;
  }

  if (ipv4Bytes) {
    bytes[12] = ipv4Bytes[0];
    bytes[13] = ipv4Bytes[1];
    bytes[14] = ipv4Bytes[2];
    bytes[15] = ipv4Bytes[3];
  }

  return bytes;
}

/**
 * Returns true if the IPv6 address falls in any blocked range, including
 * IPv4-mapped addresses whose embedded IPv4 is private.
 */
function isPrivateIpv6(addr: string): boolean {
  const b = parseIpv6ToBytes(addr);

  // ::1/128 (loopback)
  if (
    b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0 &&
    b[4] === 0 && b[5] === 0 && b[6] === 0 && b[7] === 0 &&
    b[8] === 0 && b[9] === 0 && b[10] === 0 && b[11] === 0 &&
    b[12] === 0 && b[13] === 0 && b[14] === 0 && b[15] === 1
  ) {
    return true;
  }

  // ::/128 (unspecified)
  if (
    b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0 &&
    b[4] === 0 && b[5] === 0 && b[6] === 0 && b[7] === 0 &&
    b[8] === 0 && b[9] === 0 && b[10] === 0 && b[11] === 0 &&
    b[12] === 0 && b[13] === 0 && b[14] === 0 && b[15] === 0
  ) {
    return true;
  }

  // fe80::/10 (link-local)
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;

  // fc00::/7 (ULA)
  if ((b[0] & 0xfe) === 0xfc) return true;

  // ::ffff:0:0/96 (IPv4-mapped): extract embedded IPv4 and re-check
  const isIpv4Mapped =
    b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0 &&
    b[4] === 0 && b[5] === 0 && b[6] === 0 && b[7] === 0 &&
    b[8] === 0 && b[9] === 0 && b[10] === 0xff && b[11] === 0xff;

  if (isIpv4Mapped) {
    const embedded = `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
    return isPrivateIpv4(embedded);
  }

  return false;
}

/**
 * Returns true if the given IP address (IPv4 or IPv6) is in any private,
 * reserved, or otherwise blocked range. Fails closed: returns true for
 * any address it cannot parse.
 */
export function isPrivateOrReservedIp(addr: string): boolean {
  const version = isIP(addr);
  if (version === 4) return isPrivateIpv4(addr);
  if (version === 6) return isPrivateIpv6(addr);
  return true; // unrecognized -> fail closed
}
