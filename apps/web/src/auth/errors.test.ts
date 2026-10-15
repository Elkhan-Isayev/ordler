import { AUTH_ERROR_CODES, SUPPORTED_LOCALES } from '@ordler/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client.js';
import { resources } from '../i18n/index.js';
import { errorKey } from './errors.js';

describe('error messages', () => {
  it.each(SUPPORTED_LOCALES)('translate every API error code in %s', (locale) => {
    const errors = resources[locale].translation.errors as Record<string, string>;
    for (const code of AUTH_ERROR_CODES) expect(errors[code], code).toBeTruthy();
  });
});

describe('errorKey', () => {
  it('maps known API codes', () => {
    expect(errorKey(new ApiError(401, 'invalid_credentials'))).toBe('errors.invalid_credentials');
  });

  it('prefers a known validation issue', () => {
    const error = new ApiError(400, 'validation_failed', [
      { path: 'owner.password', message: 'password_too_short' },
    ]);
    expect(errorKey(error)).toBe('errors.password_too_short');
  });

  it('falls back to a generic message', () => {
    expect(errorKey(new ApiError(500, 'boom'))).toBe('errors.unknown');
    expect(errorKey(new Error('x'))).toBe('errors.unknown');
  });
});
