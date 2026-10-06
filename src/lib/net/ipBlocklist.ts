import "server-only";

import { isIP } from "node:net";

// SSRF blocklist shared by every path that resolves a user-supplied host (media download, webhook delivery).

/** True when a dotted-decimal IPv4 address is private, reserved, loopback, link-local, CGNAT, multicast or broadcast. */
function isPrivateIpv4(addr: string): boolean {
  const parts = addr.split(".");
  const firstOctet = Number(parts[0]);
  const secondOctet = Number(parts[1]);

  if (firstOctet === 0) return true; // 0.0.0.0/8
  if (firstOctet === 10) return true; // 10.0.0.0/8
  if (firstOctet === 100 && (secondOctet & 0xc0) === 64) return true; // 100.64.0.0/10 (CGNAT)
  if (firstOctet === 127) return true; // 127.0.0.0/8
  if (firstOctet === 169 && secondOctet === 254) return true; // 169.254.0.0/16
  if (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) return true; // 172.16.0.0/12
  if (firstOctet === 192 && secondOctet === 168) return true; // 192.168.0.0/16
  if (firstOctet >= 224 && firstOctet <= 239) return true; // 224.0.0.0/4 (multicast)
  if (firstOctet >= 240) return true; // 240.0.0.0/4 (reserved + broadcast)
  return false;
}

/** Parses an IPv6 address (with :: expansion and an embedded IPv4 suffix) into 16 bytes. */
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

/** True when an IPv6 address is blocked, including IPv4-mapped addresses with a private IPv4. */
function isPrivateIpv6(addr: string): boolean {
  const bytes = parseIpv6ToBytes(addr);

  // ::1/128 (loopback)
  if (
    bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0 &&
    bytes[4] === 0 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 0 &&
    bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0 && bytes[11] === 0 &&
    bytes[12] === 0 && bytes[13] === 0 && bytes[14] === 0 && bytes[15] === 1
  ) {
    return true;
  }

  // ::/128 (unspecified)
  if (
    bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0 &&
    bytes[4] === 0 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 0 &&
    bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0 && bytes[11] === 0 &&
    bytes[12] === 0 && bytes[13] === 0 && bytes[14] === 0 && bytes[15] === 0
  ) {
    return true;
  }

  // fe80::/10 (link-local)
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;

  // fc00::/7 (ULA)
  if ((bytes[0] & 0xfe) === 0xfc) return true;

  // ::ffff:0:0/96 (IPv4-mapped): extract embedded IPv4 and re-check
  const isIpv4Mapped =
    bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0 &&
    bytes[4] === 0 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 0 &&
    bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0xff && bytes[11] === 0xff;

  if (isIpv4Mapped) {
    const embedded = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    return isPrivateIpv4(embedded);
  }

  return false;
}

/** True when an IPv4 or IPv6 address is in a blocked range; fails closed on anything unparseable. */
export function isPrivateOrReservedIp(addr: string): boolean {
  const version = isIP(addr);
  if (version === 4) return isPrivateIpv4(addr);
  if (version === 6) return isPrivateIpv6(addr);
  return true; // unrecognized -> fail closed
}
