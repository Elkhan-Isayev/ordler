import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_LENGTH = 12;

/**
 * AES-256-GCM for secrets at rest (OAuth client secrets, SMTP passwords) and for short-lived
 * tamper-proof cookies. Output: `v1.<iv>.<tag>.<ciphertext>` in base64url.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('SecretBox key must be 32 bytes');
    this.key = key;
  }

  /** `associatedData` binds a ciphertext to its purpose, so a value cannot be replayed elsewhere. */
  encrypt(plaintext: string, associatedData = ''): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  /** Returns undefined for anything malformed, tampered with, or bound to other data. */
  decrypt(sealed: string, associatedData = ''): string | undefined {
    const [version, iv, tag, ciphertext] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) return undefined;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(associatedData, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return undefined;
    }
  }
}
