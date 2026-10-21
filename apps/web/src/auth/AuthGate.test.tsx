import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from '../requests/fixtures.js';
import { ME, mockApi } from '../test/api-mock.js';
import { fakeRealtime } from '../test/realtime-fake.js';
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

  it('asks for the database while Ordler runs the installer', async () => {
    mockApi({
      'GET /api/setup/status': () => ({
        json: {
          setupRequired: true,
          databaseRequired: true,
          databaseError: 'authentication_failed',
        },
      }),
    });
    await renderWithI18n(<AuthGate browserLocale="en" />);
    expect(await screen.findByRole('heading', { name: 'Connect a database' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The user name or password is wrong.');
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

  it('returns to the deep link after signing in (MVP criterion 13)', async () => {
    const realtime = fakeRealtime();
    window.history.replaceState(null, '', '/requests/REQ-7');
    let signedIn = false;
    const calls = mockApi({
      'GET /api/setup/status': () => ({ json: { setupRequired: false } }),
      'GET /api/me': () =>
        signedIn ? { json: ME } : { status: 401, json: { error: 'unauthorized' } },
      'GET /api/auth/strategies': () => ({ json: [{ kind: 'local', displayName: null }] }),
      'POST /api/auth/password': () => {
        signedIn = true;
        return { json: ME };
      },
      'GET /api/requests/REQ-7': () => ({ json: request() }),
      'GET /api/me/counts': () => ({ json: { unread: 0, approvals: 1 } }),
    });
    await renderWithI18n(<AuthGate browserLocale="en" />);
    await userEvent.type(await screen.findByLabelText('Email'), 'ann@push30.test');
    await userEvent.type(
      screen.getByLabelText('Password', { selector: 'input' }),
      'secret-password',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/requests/REQ-7')).toBe(true));
    expect(window.location.pathname).toBe('/requests/REQ-7');
    realtime.reset();
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

describe('AuthGate invitations', () => {
  it('opens the invite page for /invite/<token> without checking the session', async () => {
    window.history.replaceState(null, '', '/invite/tok123');
    const calls = mockApi({
      'GET /api/invites/tok123': () => ({
        json: { email: 'ann@push30.test', companyName: 'Push30' },
      }),
    });
    await renderWithI18n(<AuthGate browserLocale="en" />);
    expect(await screen.findByRole('heading', { name: 'Join Push30' })).toBeInTheDocument();
    expect(calls.map((c) => c.path)).toEqual(['/api/invites/tok123']);
  });
});
