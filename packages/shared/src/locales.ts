/** Launch languages (SPEC §11.1); `en` is the source language. */
export const SUPPORTED_LOCALES = ['en', 'ru', 'de', 'az'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const SOURCE_LOCALE: Locale = 'en';

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Resolution order: user preference → instance default → browser Accept-Language → `en`.
 * Regional variants (`de-AT`) fall back to their base language.
 */
export function resolveLocale(input: {
  userPreference?: string | null;
  instanceDefault?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  const explicit = [input.userPreference, input.instanceDefault];
  for (const candidate of explicit) {
    const locale = candidate ? toLocale(candidate) : undefined;
    if (locale) return locale;
  }
  for (const tag of parseAcceptLanguage(input.acceptLanguage ?? '')) {
    const locale = toLocale(tag);
    if (locale) return locale;
  }
  return SOURCE_LOCALE;
}

function toLocale(tag: string): Locale | undefined {
  const base = tag.trim().toLowerCase().split('-')[0] ?? '';
  return isLocale(base) ? base : undefined;
}

/** Returns language tags ordered by q-value, highest first. */
export function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='))
        ?.slice(2);
      const weight = q === undefined ? 1 : Number(q);
      return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.tag !== '' && entry.tag !== '*' && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((entry) => entry.tag);
}
