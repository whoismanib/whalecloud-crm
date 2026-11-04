import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/** `Algorithm.Argon2id` (ambient const enum, not importable with isolatedModules). */
const ARGON2ID = 2;

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export interface Argon2Opts {
  memoryCost: number;
  timeCost: number;
}

/** argon2id, m=19456 KiB, t=2, p=1 by default (ADR 0004). */
export function hashPassword(password: string, o: Argon2Opts): Promise<string> {
  return hash(password, {
    algorithm: ARGON2ID,
    memoryCost: o.memoryCost,
    timeCost: o.timeCost,
    parallelism: 1,
  });
}

export function verifyPassword(phc: string, password: string): Promise<boolean> {
  return verify(phc, password).catch(() => false);
}

/** AES-256-GCM `iv:tag:ciphertext` (base64) for TOTP secrets. */
export function encrypt(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (base64)');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join(':');
}

export function decrypt(payload: string, keyB64: string): string {
  const [iv, tag, enc] = payload.split(':').map((p) => Buffer.from(p, 'base64'));
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(enc!), d.final()]).toString('utf8');
}
