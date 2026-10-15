import { SOURCE_LOCALE, type Locale } from '@ordler/shared';
import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { createIcuFormat } from './icu-format.js';
import az from './locales/az.json';
import de from './locales/de.json';
import en from './locales/en.json';
import ru from './locales/ru.json';

export const resources = {
  en: { translation: en },
  ru: { translation: ru },
  de: { translation: de },
  az: { translation: az },
} satisfies Record<Locale, { translation: unknown }>;

/** Endonyms are shown as-is in every UI language, so a user can always find their own. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  ru: 'Русский',
  de: 'Deutsch',
  az: 'Azərbaycanca',
};

export async function createI18n(locale: Locale): Promise<i18n> {
  const instance = i18next.createInstance();
  await instance
    .use(createIcuFormat())
    .use(initReactI18next)
    .init({
      resources,
      lng: locale,
      fallbackLng: SOURCE_LOCALE,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  return instance;
}
