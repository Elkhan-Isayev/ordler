import { resolveLocale } from '@ordler/shared';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { AuthGate } from './auth/AuthGate.js';
import { createI18n } from './i18n/index.js';
// Bundled, so on-prem installs never fetch fonts from the internet.
import '@fontsource-variable/inter';
import './styles.css';

const browserLocale = resolveLocale({ acceptLanguage: navigator.languages.join(',') });
const i18n = await createI18n(browserLocale);
document.documentElement.lang = browserLocale;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <AuthGate browserLocale={browserLocale} />
    </I18nextProvider>
  </StrictMode>,
);
