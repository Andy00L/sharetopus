import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { isPrivateOrReservedIp } = await import("./ipBlocklist");

const BLOCKED_BY_RANGE: Record<string, readonly string[]> = {
  "0.0.0.0/8": ["0.0.0.0", "0.255.255.255"],
  "10.0.0.0/8": ["10.0.0.1", "10.255.255.255"],
  "100.64.0.0/10": ["100.64.0.0", "100.127.255.255"],
  "127.0.0.0/8": ["127.0.0.1", "127.255.255.254"],
  "169.254.0.0/16": ["169.254.169.254"],
  "172.16.0.0/12": ["172.16.0.1", "172.31.255.255"],
  "192.168.0.0/16": ["192.168.0.1", "192.168.255.255"],
  "224.0.0.0/4": ["224.0.0.1", "239.255.255.255"],
  "240.0.0.0/4": ["240.0.0.1", "255.255.255.255"],
  "::1/128": ["::1", "0:0:0:0:0:0:0:1"],
  "::/128": ["::"],
  "fe80::/10": ["fe80::1", "febf:ffff::1"],
  "fc00::/7": ["fc00::1", "fdff:ffff::1"],
  "::ffff:0:0/96 with a blocked IPv4": ["::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "::ffff:127.0.0.1"],
  "64:ff9b::/96 (NAT64)": ["64:ff9b::a00:1", "64:ff9b::10.0.0.1", "64:ff9b::808:808"],
  "64:ff9b:1::/48 (local NAT64)": ["64:ff9b:1::a00:1", "64:ff9b:1:ffff::1"],
};

const ALLOWED_NEIGHBORS = [
  "1.1.1.1",
  "9.255.255.255",
  "11.0.0.0",
  "100.63.255.255",
  "100.128.0.0",
  "126.255.255.255",
  "128.0.0.0",
  "169.253.255.255",
  "172.15.255.255",
  "172.32.0.0",
  "192.167.255.255",
  "192.169.0.0",
  "223.255.255.255",
  "::2",
  "fec0::1",
  "fbff:ffff::1",
  "fe00::1",
  "::ffff:8.8.8.8",
  "64:ff9b:0:0:0:1::1",
  "64:ff9b:2::1",
  "2606:4700:4700::1111",
];

describe("isPrivateOrReservedIp", () => {
  for (const [rangeName, addresses] of Object.entries(BLOCKED_BY_RANGE)) {
    test(`blocks ${rangeName}`, () => {
      for (const address of addresses) expect(isPrivateOrReservedIp(address)).toBe(true);
    });
  }

  test("allows the public addresses just outside each range", () => {
    const wronglyBlocked = ALLOWED_NEIGHBORS.filter((address) => isPrivateOrReservedIp(address));
    expect(wronglyBlocked).toEqual([]);
  });

  test("treats anything that is not an IP literal as blocked", () => {
    for (const notAnIp of ["", "localhost", "10.0.0.1.nip.io", "::ffff:999.1.1.1", "1.2.3"]) {
      expect(isPrivateOrReservedIp(notAnIp)).toBe(true);
    }
  });
});
