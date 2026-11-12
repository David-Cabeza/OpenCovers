import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>;

export type TargetPolicy = {
  allowInsecure: boolean;
  resolveHost: ResolveHost;
};

export type Target = { url: URL; address: ResolvedAddress };

export type TargetCheck =
  | { ok: true; target: Target }
  | { ok: false; reason: string };

export const resolveHost: ResolveHost = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const BLOCKED_V6: [string, number][] = [
  ["::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

// An IPv6 address can embed an IPv4 one (mapped ::ffff:a.b.c.d, NAT64
// 64:ff9b::a.b.c.d). Each blocked IPv4 range is repeated inside those
// prefixes so an attacker cannot reach 127.0.0.1 by writing it as IPv6.
const EMBEDDING_V6_PREFIXES = ["::ffff:", "64:ff9b::"];

const blocked = new BlockList();
for (const [network, prefix] of BLOCKED_V4) {
  blocked.addSubnet(network, prefix, "ipv4");
  for (const embed of EMBEDDING_V6_PREFIXES) {
    blocked.addSubnet(`${embed}${network}`, 96 + prefix, "ipv6");
  }
}
for (const [network, prefix] of BLOCKED_V6) {
  blocked.addSubnet(network, prefix, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
  const bare = address.split("%")[0];
  const family = isIP(bare);
  if (family === 4) return blocked.check(bare, "ipv4");
  if (family === 6) return blocked.check(bare, "ipv6");
  return true;
}

export function parseWebhookUrl(
  raw: string,
  allowInsecure: boolean,
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  const schemes = allowInsecure ? ["https:", "http:"] : ["https:"];
  if (!schemes.includes(url.protocol)) {
    return { ok: false, reason: "URL must use https" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "URL must not carry credentials" };
  }
  return { ok: true, url };
}

export function hostOf(url: URL): string {
  return url.hostname.replace(/^\[(.*)\]$/, "$1");
}

// The address returned here is the one the caller must connect to. A second
// DNS lookup at connect time could return a different, private address
// (DNS rebinding), so delivery pins the socket to this exact address.
export async function checkTarget(raw: string, policy: TargetPolicy): Promise<TargetCheck> {
  const parsed = parseWebhookUrl(raw, policy.allowInsecure);
  if (!parsed.ok) return parsed;
  const host = hostOf(parsed.url);
  let addresses: ResolvedAddress[];
  const literal = isIP(host);
  if (literal !== 0) {
    addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await policy.resolveHost(host);
    } catch {
      return { ok: false, reason: `cannot resolve ${host}` };
    }
  }
  if (addresses.length === 0) return { ok: false, reason: `cannot resolve ${host}` };
  if (!policy.allowInsecure) {
    if (addresses.some((a) => isBlockedAddress(a.address))) {
      return { ok: false, reason: `${host} resolves to a blocked address` };
    }
  }
  return { ok: true, target: { url: parsed.url, address: addresses[0] } };
}
