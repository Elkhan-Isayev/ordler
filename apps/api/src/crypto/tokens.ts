import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { OTP_LENGTH } from '@ordler/shared';

/** 256-bit random token, URL-safe. Only its hash is ever stored. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Uniformly random numeric code, zero-padded (e.g. `004219`). */
export function generateOtp(length = OTP_LENGTH): string {
  return randomInt(0, 10 ** length)
    .toString()
    .padStart(length, '0');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
