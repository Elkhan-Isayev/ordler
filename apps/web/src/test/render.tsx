import { render, type RenderResult } from '@testing-library/react';
import type { Locale } from '@ordler/shared';
import type { i18n as I18n } from 'i18next';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from '../i18n/index.js';

export async function renderWithI18n(
  ui: ReactElement,
  locale: Locale = 'en',
): Promise<RenderResult & { i18n: I18n }> {
  const i18n = await createI18n(locale);
  return { i18n, ...render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>) };
}
