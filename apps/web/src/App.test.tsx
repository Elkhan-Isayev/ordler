import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { ME, mockApi } from './test/api-mock.js';
import { fakeRealtime } from './test/realtime-fake.js';
import { renderWithI18n } from './test/render.js';

let realtime: ReturnType<typeof fakeRealtime>;
beforeEach(() => {
  realtime = fakeRealtime();
});
afterEach(() => {
  realtime.reset();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('shows the workspace, the member’s departments and the welcome screen', async () => {
    await renderWithI18n(<App me={ME} onSignOut={vi.fn()} />, 'de');
    expect(screen.getByRole('navigation', { name: 'Push30' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /IT/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Willkommen bei Ordler' })).toBeInTheDocument();
    expect(screen.getByText('Ann Lee')).toBeInTheDocument();
  });

  it('signs out from the sidebar', async () => {
    const onSignOut = vi.fn();
    await renderWithI18n(<App me={ME} onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('shows unread and approval badges and refreshes them live', async () => {
    let counts = { unread: 2, approvals: 1 };
    mockApi({ 'GET /api/me/counts': () => ({ json: counts }) });
    await renderWithI18n(<App me={ME} onSignOut={vi.fn()} />);
    const inbox = screen.getByRole('link', { name: /Inbox/ });
    await waitFor(() => expect(inbox).toHaveTextContent('2'));
    expect(screen.getByLabelText('1 approval waiting')).toBeInTheDocument();

    counts = { unread: 3, approvals: 0 };
    realtime.push({ type: 'inbox.changed' });
    await waitFor(() => expect(inbox).toHaveTextContent('3'));
  });
});
