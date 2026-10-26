import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Argon2id with the OWASP baseline (m=19 MiB, t=2, p=1). `Algorithm.Argon2id`
 * is a const enum, so its value (2) is written out for isolated-module builds.
 */
const ARGON2 = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const ARGON2_PREFIX = `$argon2id$v=19$m=${ARGON2.memoryCost},t=${ARGON2.timeCost},p=${ARGON2.parallelism}$`;

/** Returns a PHC-format Argon2id hash: `$argon2id$v=19$m=19456,t=2,p=1$salt$hash`. */
export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password.normalize('NFKC'), ARGON2);
}

/** Verifies Argon2id hashes and Sprint 1 scrypt hashes (upgraded on the next successful login). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('$argon2id$')) {
    try {
      return await argon2Verify(stored, password.normalize('NFKC'));
    } catch {
      return false;
    }
  }
  return verifyScrypt(password, stored);
}

/** True when a stored hash is not current Argon2id with the current parameters. */
export const needsRehash = (stored: string) => !stored.startsWith(ARGON2_PREFIX);

// Legacy (Sprint 1) scrypt parameters: N=2^15, r=8, p=1 (≈32 MiB, OWASP-recommended minimum).
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Legacy Sprint 1 format `scrypt$N$r$p$salt$hash` (base64). Only kept to verify and test old hashes. */
export async function hashPasswordScrypt(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyScrypt(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await derive(password, Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A fixed hash used to equalise timing when a phone number is not registered. */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
