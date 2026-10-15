import type { i18n, I18nFormatModule } from 'i18next';
import { IntlMessageFormat } from 'intl-messageformat';

/**
 * Minimal ICU MessageFormat plugin for i18next. Replaces i18next-icu, whose default import of
 * intl-messageformat breaks under Node's CommonJS resolution (tests, server-side emails).
 */
export function createIcuFormat(): I18nFormatModule {
  const cache = new Map<string, IntlMessageFormat>();

  return {
    type: 'i18nFormat',
    init(_instance: i18n) {
      cache.clear();
    },
    parse(res: unknown, options: Record<string, unknown>, lng: string, ns: string, key: string) {
      if (typeof res !== 'string') return res;
      const cacheKey = `${lng}\u0000${ns}\u0000${key}\u0000${res}`;
      let format = cache.get(cacheKey);
      if (!format) {
        // ignoreTag keeps <0></0> placeholders intact for react-i18next <Trans>.
        format = new IntlMessageFormat(res, lng, undefined, { ignoreTag: true });
        cache.set(cacheKey, format);
      }
      return format.format(options as Record<string, string | number | boolean | Date>) as string;
    },
    addLookupKeys(finalKeys: string[]) {
      // ICU handles plural and select inside one message, so no suffixed keys are needed.
      return finalKeys;
    },
  } as I18nFormatModule;
}
