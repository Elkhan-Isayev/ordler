import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME, mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { AuthGate, takeAuthError } from './AuthGate.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('AuthGate', () => {
  it('shows the setup wizard on a fresh installation', async () => {
    mockApi({ 'GET /api/setup/status': () => ({ json: { setupRequired: true } }) });
    await renderWithI18n(<AuthGate browserLocale="en" />);
    expect(await screen.findByRole('heading', { name: 'Set up Ordler' })).toBeInTheDocument();
  });

  it('shows sign-in when there is no session', async () => {
    mockApi({
      'GET /api/setup/status': () => ({ json: { setupRequired: false } }),
      'GET /api/me': () => ({ status: 401, json: { error: 'unauthorized' } }),
      'GET /api/auth/strategies': () => ({ json: [{ kind: 'local', displayName: null }] }),
    });
    await renderWithI18n(<AuthGate browserLocale="en" />);
    expect(await screen.findByRole('heading', { name: 'Sign in to Ordler' })).toBeInTheDocument();
  });

  it('opens the app in the workspace language and signs out', async () => {
    const calls = mockApi({
      'GET /api/setup/status': () => ({ json: { setupRequired: false } }),
      'GET /api/me': () => ({ json: ME }),
      'POST /api/auth/sign-out': () => ({ status: 204 }),
      'GET /api/auth/strategies': () => ({ json: [{ kind: 'local', displayName: null }] }),
    });
    await renderWithI18n(<AuthGate browserLocale="en" />);
    expect(await screen.findByRole('navigation', { name: 'Push30' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Добро пожаловать в Ordler' }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('ru');

    await userEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/auth/sign-out')).toBe(true));
    expect(await screen.findByRole('heading', { name: 'Вход в Ordler' })).toBeInTheDocument();
  });

  it('shows a connection error when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    await renderWithI18n(<AuthGate browserLocale="en" />);
    expect(await screen.findByText(/Cannot reach the server/)).toBeInTheDocument();
  });
});

describe('takeAuthError', () => {
  it('reads the code and removes it from the URL', () => {
    window.history.replaceState(null, '', '/?auth_error=oauth_failed&x=1#top');
    expect(takeAuthError(window.location)).toBe('oauth_failed');
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/?x=1#top',
    );
  });

  it('returns nothing when absent', () => {
    expect(takeAuthError(window.location)).toBeUndefined();
  });
});

describe('AuthGate regressions', () => {
  it('stays signed out after a sign-out that changes nothing else', async () => {
    let meCalls = 0;
    mockApi({
      'GET /api/setup/status': () => ({ json: { setupRequired: false } }),
      'GET /api/me': () => {
        meCalls += 1;
        return { json: ME };
      },
      'POST /api/auth/sign-out': () => ({ status: 204 }),
      'GET /api/auth/strategies': () => ({ json: [{ kind: 'local', displayName: null }] }),
    });
    await renderWithI18n(<AuthGate browserLocale="en" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Выйти' }));
    expect(await screen.findByRole('heading', { name: 'Вход в Ordler' })).toBeInTheDocument();
    // The language switch to Russian must not re-run the bootstrap and sign the user back in.
    expect(meCalls).toBe(1);
  });
});
