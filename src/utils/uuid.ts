import crypto from 'crypto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function uuidToBytes(uuid: string): Buffer {
  if (!validateUuid(uuid)) {
    throw new Error('invalid_uuid_namespace');
  }
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

export function uuidv4(): string {
  return crypto.randomUUID();
}

export function uuidv5(name: string, namespace: string): string {
  const namespaceBytes = uuidToBytes(namespace);
  const hash = crypto
    .createHash('sha1')
    .update(Buffer.concat([namespaceBytes, Buffer.from(name, 'utf8')]))
    .digest();

  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return bytesToUuid(hash.subarray(0, 16));
}

export function validateUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}
