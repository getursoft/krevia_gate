import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes with a random salt and verifies', async () => {
    const a = await hashPassword('Resident123');
    const b = await hashPassword('Resident123');
    expect(a).not.toEqual(b);
    expect(a.startsWith('scrypt$32768$8$1$')).toBe(true);
    await expect(verifyPassword('Resident123', a)).resolves.toBe(true);
    await expect(verifyPassword('resident123', a)).resolves.toBe(false);
  });

  it('rejects malformed stored hashes', async () => {
    await expect(verifyPassword('x', 'plaintext')).resolves.toBe(false);
    await expect(verifyPassword('x', 'bcrypt$1$2$3$4$5')).resolves.toBe(false);
  });
});
