import { describe, expect, it } from 'vitest';
import { isTheme, mePreferencesSchema } from './preferences.js';

describe('theme preferences', () => {
  it('accepts the three themes', () => {
    for (const theme of ['system', 'light', 'dark']) {
      expect(mePreferencesSchema.parse({ theme })).toEqual({ theme });
      expect(isTheme(theme)).toBe(true);
    }
  });

  it('rejects unknown themes and extra fields', () => {
    expect(mePreferencesSchema.safeParse({ theme: 'sepia' }).success).toBe(false);
    expect(mePreferencesSchema.safeParse({ theme: 'dark', locale: 'ru' }).success).toBe(false);
    expect(isTheme('sepia')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});
