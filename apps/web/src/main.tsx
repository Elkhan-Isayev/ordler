import { resolveLocale } from '@ordler/shared';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { App } from './App.js';
import { createI18n } from './i18n/index.js';
import './styles.css';

const locale = resolveLocale({ acceptLanguage: navigator.languages.join(',') });
const i18n = await createI18n(locale);
document.documentElement.lang = locale;

// Placeholder data until the API exposes the member's departments and counters.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <App workspaceName="Ordler" inboxCount={0} pendingApprovals={0} departments={[]} />
    </I18nextProvider>
  </StrictMode>,
);
