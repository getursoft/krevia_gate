import { hashPassword, hashPasswordScrypt, needsRehash, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes with Argon2id and a random salt, and verifies', async () => {
    const a = await hashPassword('Resident123');
    const b = await hashPassword('Resident123');
    expect(a).not.toEqual(b);
    expect(a.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(needsRehash(a)).toBe(false);
    await expect(verifyPassword('Resident123', a)).resolves.toBe(true);
    await expect(verifyPassword('resident123', a)).resolves.toBe(false);
  });

  it('still verifies Sprint 1 scrypt hashes and marks them for upgrade', async () => {
    const legacy = await hashPasswordScrypt('Resident123');
    expect(legacy.startsWith('scrypt$32768$8$1$')).toBe(true);
    await expect(verifyPassword('Resident123', legacy)).resolves.toBe(true);
    await expect(verifyPassword('resident123', legacy)).resolves.toBe(false);
    expect(needsRehash(legacy)).toBe(true);
  });

  it('rejects malformed stored hashes', async () => {
    await expect(verifyPassword('x', 'plaintext')).resolves.toBe(false);
    await expect(verifyPassword('x', 'bcrypt$1$2$3$4$5')).resolves.toBe(false);
    await expect(verifyPassword('x', '$argon2id$v=19$garbage')).resolves.toBe(false);
  });
});
