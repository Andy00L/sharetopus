import "server-only";

import { BlockList, isIP } from "node:net";

const BLOCKED_SUBNETS = [
  { network: "0.0.0.0", prefix: 8, family: "ipv4" },
  { network: "10.0.0.0", prefix: 8, family: "ipv4" },
  { network: "100.64.0.0", prefix: 10, family: "ipv4" },
  { network: "127.0.0.0", prefix: 8, family: "ipv4" },
  { network: "169.254.0.0", prefix: 16, family: "ipv4" },
  { network: "172.16.0.0", prefix: 12, family: "ipv4" },
  { network: "192.168.0.0", prefix: 16, family: "ipv4" },
  { network: "224.0.0.0", prefix: 4, family: "ipv4" },
  { network: "240.0.0.0", prefix: 4, family: "ipv4" },
  { network: "::1", prefix: 128, family: "ipv6" },
  { network: "::", prefix: 128, family: "ipv6" },
  { network: "fe80::", prefix: 10, family: "ipv6" },
  { network: "fc00::", prefix: 7, family: "ipv6" },
  { network: "64:ff9b::", prefix: 96, family: "ipv6" },
  { network: "64:ff9b:1::", prefix: 48, family: "ipv6" },
] as const satisfies readonly { network: string; prefix: number; family: "ipv4" | "ipv6" }[];

// BlockList matches an IPv4-mapped IPv6 address (::ffff:a.b.c.d) against the
// IPv4 rules (checked on Node 22.23 and Bun 1.4.3), so ::ffff:0:0/96 needs no
// rule of its own.
const BLOCKED_ADDRESSES = new BlockList();
for (const subnet of BLOCKED_SUBNETS) {
  BLOCKED_ADDRESSES.addSubnet(subnet.network, subnet.prefix, subnet.family);
}

export function isPrivateOrReservedIp(address: string): boolean {
  const ipVersion = isIP(address);
  if (ipVersion === 0) return true;
  return BLOCKED_ADDRESSES.check(address, ipVersion === 4 ? "ipv4" : "ipv6");
}
