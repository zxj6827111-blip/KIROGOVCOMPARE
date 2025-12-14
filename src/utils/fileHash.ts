import * as crypto from 'crypto';
import * as fs from 'fs';

const HASH_ALGORITHM = 'sha256';

export async function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(HASH_ALGORITHM);
    const stream = fs.createReadStream(filePath);

    stream.on('data', (data) => {
      hash.update(data);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });

    stream.on('error', (error) => {
      reject(error);
    });
  });
}

export async function calculateBufferHash(buffer: Buffer): Promise<string> {
  const hash = crypto.createHash(HASH_ALGORITHM);
  hash.update(buffer);
  return hash.digest('hex');
}
