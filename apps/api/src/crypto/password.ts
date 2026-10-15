import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

/** OWASP-recommended Argon2id baseline: 19 MiB memory, 2 passes, 1 lane. */
export interface Argon2Params {
  memory: number;
  passes: number;
  parallelism: number;
}

export const DEFAULT_ARGON2: Argon2Params = { memory: 19_456, passes: 2, parallelism: 1 };

const TAG_LENGTH = 32;
const SALT_LENGTH = 16;

/** Encodes as a PHC string: `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` (base64, no padding). */
export async function hashPassword(
  password: string,
  params: Argon2Params = DEFAULT_ARGON2,
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, params);
  return [
    '',
    'argon2id',
    'v=19',
    `m=${params.memory},t=${params.passes},p=${params.parallelism}`,
    b64(salt),
    b64(hash),
  ].join('$');
}

export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  const parsed = parsePhc(encoded);
  if (!parsed) return false;
  const actual = await derive(password, parsed.salt, parsed.params);
  return actual.length === parsed.hash.length && timingSafeEqual(actual, parsed.hash);
}

/** True when the stored hash used weaker parameters than the current defaults. */
export function needsRehash(encoded: string, params: Argon2Params = DEFAULT_ARGON2): boolean {
  const parsed = parsePhc(encoded);
  if (!parsed) return true;
  return (
    parsed.params.memory < params.memory ||
    parsed.params.passes < params.passes ||
    parsed.params.parallelism !== params.parallelism
  );
}

async function derive(password: string, salt: Buffer, params: Argon2Params): Promise<Buffer> {
  return argon2Async('argon2id', {
    message: Buffer.from(password.normalize('NFKC'), 'utf8'),
    nonce: salt,
    parallelism: params.parallelism,
    tagLength: TAG_LENGTH,
    memory: params.memory,
    passes: params.passes,
  });
}

function parsePhc(
  encoded: string,
): { params: Argon2Params; salt: Buffer; hash: Buffer } | undefined {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[1] !== 'argon2id' || parts[2] !== 'v=19') return undefined;
  const match = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(parts[3] ?? '');
  if (!match) return undefined;
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const hash = Buffer.from(parts[5] ?? '', 'base64');
  if (salt.length < 8 || hash.length === 0) return undefined;
  return {
    params: { memory: Number(match[1]), passes: Number(match[2]), parallelism: Number(match[3]) },
    salt,
    hash,
  };
}

function b64(buffer: Buffer): string {
  return buffer.toString('base64').replace(/=+$/, '');
}
