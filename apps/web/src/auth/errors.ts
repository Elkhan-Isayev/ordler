import en from '../i18n/locales/en.json';
import { ApiError } from '../api/client.js';

const KNOWN = new Set(Object.keys(en.errors));

/** Maps any failure to a translation key under `errors.*`; unknown codes get a generic message. */
export function errorKey(error: unknown): string {
  if (error instanceof ApiError) {
    const issueCode = error.issues?.[0]?.message;
    if (error.code === 'validation_failed' && issueCode && KNOWN.has(issueCode)) {
      return `errors.${issueCode}`;
    }
    if (KNOWN.has(error.code)) return `errors.${error.code}`;
  }
  return 'errors.unknown';
}

export function isKnownErrorCode(code: string): boolean {
  return KNOWN.has(code);
}
