import * as net from 'net';
import dns from 'dns/promises';

const INTERNAL_IP_PATTERNS = [
  /^127\./,                          // Loopback
  /^192\.168\./,                     // Private Class C
  /^10\./,                           // Private Class A
  /^172\.(1[6-9]|2[0-9]|3[01])\./,   // Private Class B
  /^169\.254\./,                     // Link-local / Cloud metadata (AWS, GCP, Azure)
  /^0\./,                            // Zero addresses
  /^::1$/,                           // IPv6 loopback
  /^fc00:/,                          // IPv6 private
  /^fe80:/,                          // IPv6 link-local
  /^::$/,                            // IPv6 zero address
  /^0\.0\.0\.0$/,                    // Zero address
];

// Block known cloud metadata hostnames
const BLOCKED_HOSTNAMES = [
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'kubernetes.default',
];

export interface URLValidationResult {
  valid: boolean;
  error?: string;
}

export function validateURLFormat(urlString: string): URLValidationResult {
  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: 'URL协议无效，仅支持HTTP/HTTPS' };
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'URL格式无效' };
  }
}

export function isInternalIP(hostname: string): boolean {
  // 移除端口
  const host = hostname.split(':')[0].toLowerCase();

  // SECURITY: Check blocked cloud metadata hostnames
  if (BLOCKED_HOSTNAMES.some(blocked => host === blocked || host.endsWith('.' + blocked))) {
    return true;
  }

  // 检查localhost
  if (host === 'localhost') {
    return true;
  }

  // 检查IPv4
  if (net.isIPv4(host)) {
    return INTERNAL_IP_PATTERNS.some((pattern) => pattern.test(host));
  }

  // 检查IPv6
  if (net.isIPv6(host)) {
    return INTERNAL_IP_PATTERNS.some((pattern) => pattern.test(host));
  }

  return false;
}

async function resolveHostIPs(hostname: string): Promise<string[]> {
  try {
    const results = await dns.lookup(hostname, { all: true });
    return results.map((r) => r.address);
  } catch {
    return [];
  }
}

export async function isInternalHost(hostname: string): Promise<boolean> {
  const host = hostname.split(':')[0].toLowerCase();

  if (isInternalIP(host)) {
    return true;
  }

  const resolved = await resolveHostIPs(host);
  if (resolved.length === 0) {
    return true;
  }

  return resolved.some((ip) => isInternalIP(ip));
}

export async function validateURLSecurity(urlString: string): Promise<URLValidationResult> {
  try {
    const url = new URL(urlString);

    // 检查协议
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: 'URL协议无效，仅支持HTTP/HTTPS' };
    }

    // 检查内网地址
    if (await isInternalHost(url.hostname)) {
      return { valid: false, error: 'URL被SSRF防护拒绝，不支持内网地址' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'URL验证失败' };
  }
}

export async function validateRedirectURL(
  originalURL: string,
  redirectURL: string
): Promise<URLValidationResult> {
  try {
    const original = new URL(originalURL);
    const redirect = new URL(redirectURL);

    // 检查协议降级（HTTPS -> HTTP）
    if (original.protocol === 'https:' && redirect.protocol === 'http:') {
      return { valid: false, error: '不允许从HTTPS降级到HTTP' };
    }

    // 检查内网地址
    if (await isInternalHost(redirect.hostname)) {
      return { valid: false, error: '重定向目标为内网地址，被拒绝' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: '重定向URL验证失败' };
  }
}
