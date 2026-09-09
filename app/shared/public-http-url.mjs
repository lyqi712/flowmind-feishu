const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  '0.0.0.0',
  '::',
  '::1'
]);

const IPV4_BLOCKED_CIDRS = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];

const IPV6_BLOCKED_CIDRS = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
];

export function canonicalizeHostname(host) {
  let value = String(host || '').trim().toLowerCase();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  while (value.endsWith('.')) value = value.slice(0, -1);
  const zone = value.indexOf('%');
  if (zone >= 0) value = value.slice(0, zone);
  return value;
}

function ipv4ToBytes(ip) {
  const parts = String(ip || '').split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    const value = Number(parts[i]);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    bytes[i] = value;
  }
  return bytes;
}

function ipv6ToBytes(ip) {
  let value = canonicalizeHostname(ip);
  if (!value || !value.includes(':')) return null;
  const ipv4Tail = value.includes('.') ? ipv4ToBytes(value.slice(value.lastIndexOf(':') + 1)) : null;
  if (value.includes('.')) {
    if (!ipv4Tail) return null;
    value = value.slice(0, value.lastIndexOf(':'));
  }
  if ((value.match(/::/g) || []).length > 1) return null;
  const [head, tail = ''] = value.includes('::') ? value.split('::') : [value, ''];
  const parseParts = part => (part ? part.split(':').filter(Boolean) : []);
  const headParts = parseParts(head);
  const tailParts = parseParts(tail);
  const needed = 8 - (ipv4Tail ? 2 : 0);
  if (headParts.length + tailParts.length > needed) return null;
  if (!value.includes('::') && headParts.length !== needed) return null;
  const missing = value.includes('::') ? needed - headParts.length - tailParts.length : 0;
  const hextets = [...headParts, ...Array(missing).fill('0'), ...tailParts];
  if (hextets.length !== needed) return null;
  const bytes = new Uint8Array(16);
  let offset = 0;
  for (const hextet of hextets) {
    if (!/^[0-9a-f]{1,4}$/i.test(hextet)) return null;
    const valueNum = Number.parseInt(hextet, 16);
    bytes[offset] = (valueNum >> 8) & 0xff;
    bytes[offset + 1] = valueNum & 0xff;
    offset += 2;
  }
  if (ipv4Tail) bytes.set(ipv4Tail, 12);
  return bytes;
}

function bytesInCidr(bytes, baseBytes, prefix) {
  if (!bytes || !baseBytes || bytes.length !== baseBytes.length) return false;
  const totalBits = bytes.length * 8;
  const bits = Math.max(0, Math.min(totalBits, Number(prefix) || 0));
  for (let i = 0; i < bytes.length; i += 1) {
    const remaining = bits - i * 8;
    if (remaining >= 8) {
      if (bytes[i] !== baseBytes[i]) return false;
    } else if (remaining > 0) {
      const mask = (0xff << (8 - remaining)) & 0xff;
      if ((bytes[i] & mask) !== (baseBytes[i] & mask)) return false;
    } else {
      return true;
    }
  }
  return true;
}

function ipv4Blocked(bytes) {
  return IPV4_BLOCKED_CIDRS.some(([cidr, prefix]) => bytesInCidr(bytes, ipv4ToBytes(cidr), prefix));
}

function embeddedIpv4(bytes6) {
  if (bytesInCidr(bytes6, ipv6ToBytes('::ffff:0:0'), 96)) return bytes6.slice(12);
  if (bytesInCidr(bytes6, ipv6ToBytes('64:ff9b::'), 96)) return bytes6.slice(12);
  if (bytesInCidr(bytes6, ipv6ToBytes('64:ff9b:1::'), 48)) return bytes6.slice(12);
  if (bytesInCidr(bytes6, ipv6ToBytes('2002::'), 16)) return bytes6.slice(2, 6);
  if (
    bytesInCidr(bytes6, ipv6ToBytes('::'), 96)
    && !bytesInCidr(bytes6, ipv6ToBytes('::'), 128)
    && !bytesInCidr(bytes6, ipv6ToBytes('::1'), 128)
  ) {
    return bytes6.slice(12);
  }
  return null;
}

function ipv6Blocked(bytes) {
  if (IPV6_BLOCKED_CIDRS.some(([cidr, prefix]) => bytesInCidr(bytes, ipv6ToBytes(cidr), prefix))) return true;
  const mapped = embeddedIpv4(bytes);
  return Boolean(mapped && ipv4Blocked(mapped));
}

export function ipVersion(value) {
  const host = canonicalizeHostname(value);
  if (ipv4ToBytes(host)) return 4;
  if (ipv6ToBytes(host)) return 6;
  return 0;
}

export function isPrivateOrReservedIp(ip) {
  const host = canonicalizeHostname(ip);
  if (!host) return true;
  const v4 = ipv4ToBytes(host);
  if (v4) return ipv4Blocked(v4);
  const v6 = ipv6ToBytes(host);
  if (v6) return ipv6Blocked(v6);
  return true;
}

export function isPrivateIpAddress(ip) {
  return isPrivateOrReservedIp(ip);
}

export function isBlockedHostname(host) {
  const hostname = canonicalizeHostname(host);
  if (!hostname) return true;
  if (BLOCKED_HOSTS.has(hostname)) return true;
  if (hostname.endsWith('.localhost') || hostname.endsWith('.local')) return true;
  if (ipVersion(hostname)) return isPrivateOrReservedIp(hostname);
  return false;
}

export function httpError(message, code, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

export function normalizeBrowseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw httpError('请输入网址', 'WEB_URL_REQUIRED');
  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withProtocol);
  } catch {
    throw httpError('网址无效', 'WEB_URL_INVALID');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw httpError('只支持 http/https 网页', 'WEB_URL_PROTOCOL');
  }
  if (url.username || url.password) {
    throw httpError('网址不能包含凭据', 'WEB_URL_CREDENTIALS');
  }
  if (isBlockedHostname(url.hostname)) {
    throw httpError('不能打开内网或本机地址', 'WEB_URL_PRIVATE');
  }
  url.hash = '';
  return url;
}
