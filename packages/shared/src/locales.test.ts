import { describe, expect, it } from 'vitest';
import { parseAcceptLanguage, resolveLocale } from './locales.js';

describe('resolveLocale', () => {
  it('prefers the user preference', () => {
    expect(
      resolveLocale({ userPreference: 'az', instanceDefault: 'ru', acceptLanguage: 'de' }),
    ).toBe('az');
  });

  it('falls back to the instance default', () => {
    expect(
      resolveLocale({ userPreference: null, instanceDefault: 'ru', acceptLanguage: 'de' }),
    ).toBe('ru');
  });

  it('uses Accept-Language by weight and maps regional tags to their base', () => {
    expect(resolveLocale({ acceptLanguage: 'fr-FR, de-AT;q=0.8, ru;q=0.5' })).toBe('de');
  });

  it('skips unsupported explicit values', () => {
    expect(resolveLocale({ userPreference: 'fr', acceptLanguage: 'ru' })).toBe('ru');
  });

  it('defaults to English', () => {
    expect(resolveLocale({})).toBe('en');
    expect(resolveLocale({ acceptLanguage: 'ja, zh;q=0.9' })).toBe('en');
  });
});

describe('parseAcceptLanguage', () => {
  it('orders by q-value and keeps header order on ties', () => {
    expect(parseAcceptLanguage('ru;q=0.5, en, de;q=0.9, az')).toEqual(['en', 'az', 'de', 'ru']);
  });

  it('drops wildcards, empty parts and q=0', () => {
    expect(parseAcceptLanguage('*, , de;q=0, ru')).toEqual(['ru']);
  });
});
