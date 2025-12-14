import * as net from 'net';

const INTERNAL_IP_PATTERNS = [
  /^127\./,
  /^192\.168\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
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
  const ip = hostname.split(':')[0];

  // 检查IPv4
  if (net.isIPv4(ip)) {
    return INTERNAL_IP_PATTERNS.some((pattern) => pattern.test(ip));
  }

  // 检查IPv6
  if (net.isIPv6(ip)) {
    return INTERNAL_IP_PATTERNS.some((pattern) => pattern.test(ip));
  }

  // 检查localhost
  if (ip === 'localhost') {
    return true;
  }

  return false;
}

export function validateURLSecurity(urlString: string): URLValidationResult {
  try {
    const url = new URL(urlString);

    // 检查协议
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: 'URL协议无效，仅支持HTTP/HTTPS' };
    }

    // 检查内网地址
    if (isInternalIP(url.hostname)) {
      return { valid: false, error: 'URL被SSRF防护拒绝，不支持内网地址' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'URL验证失败' };
  }
}

export function validateRedirectURL(
  originalURL: string,
  redirectURL: string
): URLValidationResult {
  try {
    const original = new URL(originalURL);
    const redirect = new URL(redirectURL);

    // 检查协议降级（HTTPS -> HTTP）
    if (original.protocol === 'https:' && redirect.protocol === 'http:') {
      return { valid: false, error: '不允许从HTTPS降级到HTTP' };
    }

    // 检查内网地址
    if (isInternalIP(redirect.hostname)) {
      return { valid: false, error: '重定向目标为内网地址，被拒绝' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: '重定向URL验证失败' };
  }
}
