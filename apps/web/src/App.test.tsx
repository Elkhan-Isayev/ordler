import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';
import { createI18n } from './i18n/index.js';

describe('App', () => {
  it('renders the sidebar and the welcome screen in the chosen language', async () => {
    const i18n = await createI18n('de');
    render(
      <I18nextProvider i18n={i18n}>
        <App workspaceName="Ordler" inboxCount={0} pendingApprovals={0} departments={[]} />
      </I18nextProvider>,
    );
    expect(screen.getByRole('navigation', { name: 'Ordler' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Willkommen bei Ordler' })).toBeInTheDocument();
  });
});
