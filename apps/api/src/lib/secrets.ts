import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

let key: Buffer | null = null;

/**
 * 32-byte key for encrypting user secrets at rest. Uses APP_SECRET when set (required in
 * production); otherwise a random key is generated once into .data/app-secret for local development.
 */
function secretKey(): Buffer {
  if (key) return key;
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv) return (key = createHash('sha256').update(fromEnv).digest());
  if (process.env.NODE_ENV === 'production') throw new Error('APP_SECRET must be set in production to store API keys');
  const file = resolve(process.cwd(), '.data/app-secret');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  return (key = createHash('sha256').update(readFileSync(file, 'utf8')).digest());
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
}

export function decryptSecret(blob: string): string {
  const raw = Buffer.from(blob.replace(/^v1:/, ''), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
