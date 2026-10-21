import type { NotificationView } from '@ordler/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { fakeRealtime } from '../test/realtime-fake.js';
import { renderWithI18n } from '../test/render.js';
import { InboxPage } from './InboxPage.js';

let realtime: ReturnType<typeof fakeRealtime>;
beforeEach(() => {
  realtime = fakeRealtime();
});
afterEach(() => {
  realtime.reset();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

function notification(id: string, overrides: Partial<NotificationView> = {}): NotificationView {
  return {
    id,
    kind: 'issue_assigned',
    subject: { type: 'issue', identifier: 'HELP-4', title: 'VPN is down', path: '/issue/HELP-4' },
    actor: { id: 'm2', name: 'Rauf' },
    data: {},
    read: false,
    createdAt: '2026-10-20T09:00:00Z',
    ...overrides,
  };
}

describe('InboxPage', () => {
  it('lists notifications and marks one read when opened', async () => {
    const calls = mockApi({
      'GET /api/me/notifications': () => ({ json: [notification('n1')] }),
      'POST /api/me/notifications/mark': () => ({ json: { unread: 0, approvals: 0 } }),
    });
    await renderWithI18n(<InboxPage memberId="m1" />);
    const link = await screen.findByRole('link', { name: /Rauf assigned you HELP-4/ });
    expect(link).toHaveAttribute('href', '/issue/HELP-4');
    await userEvent.click(link);
    expect(window.location.pathname).toBe('/issue/HELP-4');
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      path: '/api/me/notifications/mark',
      body: { ids: ['n1'], read: true },
    });
  });

  it('marks everything read and toggles single items back', async () => {
    const calls = mockApi({
      'GET /api/me/notifications': () => ({
        json: [notification('n1'), notification('n2', { kind: 'approval_requested', read: true })],
      }),
      'POST /api/me/notifications/mark': () => ({ json: { unread: 0, approvals: 0 } }),
    });
    await renderWithI18n(<InboxPage memberId="m1" />);
    await screen.findByText('Your approval is needed on HELP-4');
    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    expect(calls.at(-1)).toMatchObject({ body: { read: true } });
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();

    await userEvent.click(screen.getAllByRole('button', { name: 'Mark as unread' })[1]!);
    expect(calls.at(-1)).toMatchObject({ body: { ids: ['n2'], read: false } });
  });

  it('refreshes when the server says the Inbox changed', async () => {
    let list = [notification('n1')];
    mockApi({ 'GET /api/me/notifications': () => ({ json: list }) });
    await renderWithI18n(<InboxPage memberId="m1" />);
    await screen.findByText('VPN is down');
    list = [
      notification('n2', { subject: { ...list[0]!.subject, title: 'Printer jam' } }),
      ...list,
    ];
    realtime.push({ type: 'inbox.changed' });
    await waitFor(() => expect(screen.getByText('Printer jam')).toBeInTheDocument());
  });

  it('says when there is nothing new', async () => {
    mockApi({ 'GET /api/me/notifications': () => ({ json: [] }) });
    await renderWithI18n(<InboxPage memberId="m1" />, 'ru');
    expect(await screen.findByText(/Ничего нового/)).toBeInTheDocument();
  });
});
