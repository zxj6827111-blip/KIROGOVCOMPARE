const DEFAULT_PATTERNS: Array<[RegExp, string]> = [
  [/authorization:\s*bearer\s+[^\s]+/gi, 'authorization: Bearer [REDACTED]'],
  [/bearer\s+[A-Za-z0-9\-_\.]+/gi, 'Bearer [REDACTED]'],
  [/token=([A-Za-z0-9\-_\.]+)/gi, 'token=[REDACTED]'],
  [/password=([^\s&]+)/gi, 'password=[REDACTED]'],
  [/JWT_SECRET=([^\s]+)/gi, 'JWT_SECRET=[REDACTED]'],
  [/ADMIN_BOOTSTRAP_TOKEN=([^\s]+)/gi, 'ADMIN_BOOTSTRAP_TOKEN=[REDACTED]'],
];

export function redactSensitive(input: unknown): string {
  const raw =
    input instanceof Error
      ? `${input.message}\n${input.stack ?? ''}`
      : String(input);

  let redacted = raw;
  for (const [pattern, replacement] of DEFAULT_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}
