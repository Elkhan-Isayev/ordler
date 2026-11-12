import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME, mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { applyTheme } from '../theme/theme.js';
import { AppearancePage } from './AppearancePage.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  applyTheme('system');
});

describe('AppearancePage', () => {
  it('switches the theme at once and saves it for the member', async () => {
    const calls = mockApi({
      'PATCH /api/me/preferences': (body) => ({
        json: { ...ME, member: { ...ME.member, ...(body as object) } },
      }),
    });
    await renderWithI18n(<AppearancePage />);
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: '/api/me/preferences',
        body: { theme: 'dark' },
      }),
    );
  });

  it('goes back to the previous theme when saving fails', async () => {
    applyTheme('light');
    mockApi({
      'PATCH /api/me/preferences': () => ({ status: 400, json: { error: 'validation_failed' } }),
    });
    await renderWithI18n(<AppearancePage />);
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked());
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
