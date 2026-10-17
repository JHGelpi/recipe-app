import { BlockList, isIP } from 'node:net';

// Addresses a pasted link must never reach: this machine, the Docker network,
// the owner's LAN, cloud metadata, and ranges that embed them.
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
const BLOCKED_V6: [string, number][] = [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local NAT64
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
];

const blocked = new BlockList();
for (const [net, prefix] of BLOCKED_V4) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of BLOCKED_V6) blocked.addSubnet(net, prefix, 'ipv6');

// BlockList matches IPv4 checks against an IPv4-mapped IPv6 subnet too, so
// mapped addresses (::ffff:7f00:1, ::ffff:127.0.0.1) are turned back into
// IPv4 and checked against the IPv4 list instead.
const MAPPED = /^(?:0{0,4}:){0,5}:?ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i;

function asIpv4(ip: string): string | null {
  const match = MAPPED.exec(ip);
  if (!match) return null;
  if (match[1]) return match[1];
  const high = Number.parseInt(match[2] ?? '', 16);
  const low = Number.parseInt(match[3] ?? '', 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/** True for anything that is not a public unicast address, including text that is not an address. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true;
  if (family === 4) return blocked.check(ip, 'ipv4');
  const mapped = asIpv4(ip);
  if (mapped !== null) return isIP(mapped) !== 4 || blocked.check(mapped, 'ipv4');
  return blocked.check(ip, 'ipv6');
}
