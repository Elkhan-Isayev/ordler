import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword, type Argon2Params } from './password.js';
import { SecretBox } from './secret-box.js';
import { constantTimeEqual, generateOtp, randomToken, sha256 } from './tokens.js';

// Cheap parameters keep the suite fast; production defaults are covered by needsRehash.
const FAST: Argon2Params = { memory: 1024, passes: 1, parallelism: 1 };

describe('password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('correct horse battery', FAST);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=1024,t=1,p=1\$/);
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse batterY')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same password', FAST)).not.toBe(
      await hashPassword('same password', FAST),
    );
  });

  it('normalises Unicode so visually equal passwords match', async () => {
    const hash = await hashPassword('ﬁle-password', FAST);
    expect(await verifyPassword(hash, 'file-password')).toBe(true);
  });

  it.each(['', 'plain', '$argon2i$v=19$m=1,t=1,p=1$AAAA$AAAA', '$argon2id$v=19$bad$AAAA$AAAA'])(
    'rejects malformed hash %j',
    async (encoded) => {
      expect(await verifyPassword(encoded, 'anything')).toBe(false);
    },
  );

  it('flags weaker parameters for rehash', async () => {
    expect(needsRehash(await hashPassword('pw-for-rehash', FAST))).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
  });

  it('accepts hashes at the default parameters', async () => {
    expect(needsRehash(await hashPassword('pw-default-params'))).toBe(false);
  });
});

describe('SecretBox', () => {
  const box = new SecretBox(randomBytes(32));

  it('round-trips', () => {
    const sealed = box.encrypt('client-secret-123');
    expect(sealed).not.toContain('client-secret-123');
    expect(box.decrypt(sealed)).toBe('client-secret-123');
  });

  it('uses a fresh IV each time', () => {
    expect(box.encrypt('x')).not.toBe(box.encrypt('x'));
  });

  it('rejects tampering', () => {
    const sealed = box.encrypt('client-secret-123');
    const parts = sealed.split('.');
    const ciphertext = Buffer.from(parts[3]!, 'base64url');
    ciphertext[0] = ciphertext[0]! ^ 1;
    parts[3] = ciphertext.toString('base64url');
    expect(box.decrypt(parts.join('.'))).toBeUndefined();
  });

  it('binds ciphertexts to their associated data', () => {
    const sealed = box.encrypt('state', 'oauth-state');
    expect(box.decrypt(sealed, 'oauth-state')).toBe('state');
    expect(box.decrypt(sealed, 'session')).toBeUndefined();
  });

  it('rejects other keys and malformed input', () => {
    const other = new SecretBox(randomBytes(32));
    expect(other.decrypt(box.encrypt('x'))).toBeUndefined();
    expect(box.decrypt('v2.a.b.c')).toBeUndefined();
    expect(box.decrypt('nonsense')).toBeUndefined();
  });

  it('requires a 32-byte key', () => {
    expect(() => new SecretBox(randomBytes(16))).toThrow(/32 bytes/);
  });
});

describe('tokens', () => {
  it('generates URL-safe random tokens', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
  });

  it('hashes deterministically', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('generates zero-padded numeric OTPs', () => {
    for (let i = 0; i < 200; i += 1) expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it('compares in constant time', () => {
    expect(constantTimeEqual('123456', '123456')).toBe(true);
    expect(constantTimeEqual('123456', '123457')).toBe(false);
    expect(constantTimeEqual('123', '123456')).toBe(false);
  });
});
