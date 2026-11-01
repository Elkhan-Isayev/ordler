import type { InboundEmailView, InboxSettingsView } from '@ordler/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { IncomingMail } from './IncomingMail.js';

afterEach(() => vi.unstubAllGlobals());

const empty: InboxSettingsView = {
  configured: false,
  enabled: false,
  host: null,
  port: 993,
  security: 'tls',
  verifyTls: true,
  username: null,
  passwordSet: false,
  folder: 'INBOX',
  lastPollAt: null,
  lastError: null,
};

const configured: InboxSettingsView = {
  ...empty,
  configured: true,
  enabled: true,
  host: 'imap.push30.test',
  username: 'ordler',
  passwordSet: true,
  lastPollAt: '2026-11-01T09:00:00.000Z',
};

const messages: InboundEmailView[] = [
  {
    id: 'e1',
    from: 'ana@push30.test',
    to: ['it@push30.test'],
    subject: 'Printer jammed',
    status: 'created',
    reason: null,
    request: { id: 'r1', identifier: 'REQ-12' },
    receivedAt: '2026-11-01T09:00:00.000Z',
  },
  {
    id: 'e2',
    from: 'bo@push30.test',
    to: ['it@push30.test'],
    subject: 'Need a laptop',
    status: 'rejected',
    reason: 'form_invalid',
    request: null,
    receivedAt: '2026-11-01T08:00:00.000Z',
  },
];

describe('IncomingMail', () => {
  it('saves the mailbox and sends the password only when typed', async () => {
    const calls = mockApi({
      'GET /api/admin/mail/inbox': () => ({ json: empty }),
      'GET /api/admin/mail/inbox/messages': () => ({ json: [] }),
      'PUT /api/admin/mail/inbox': () => ({ json: configured }),
    });
    await renderWithI18n(<IncomingMail />);
    const form = await screen.findByRole('form', { name: 'Incoming mail' });
    await userEvent.click(within(form).getByLabelText('Read this mailbox'));
    await userEvent.type(within(form).getByLabelText('IMAP host'), 'imap.push30.test');
    await userEvent.type(within(form).getByLabelText('Username'), 'ordler');
    await userEvent.type(within(form).getByLabelText('Password'), 'imap-secret');
    await userEvent.click(within(form).getByRole('button', { name: 'Save mailbox' }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        enabled: true,
        host: 'imap.push30.test',
        port: 993,
        security: 'tls',
        verifyTls: true,
        username: 'ordler',
        folder: 'INBOX',
        password: 'imap-secret',
      }),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(within(form).getByLabelText('Password')).toHaveValue('');
  });

  it('lists recent messages with their request or why none was created', async () => {
    mockApi({
      'GET /api/admin/mail/inbox': () => ({ json: configured }),
      'GET /api/admin/mail/inbox/messages': () => ({ json: messages }),
    });
    await renderWithI18n(<IncomingMail />);
    const list = await screen.findByRole('list', { name: 'Recent messages' });
    expect(within(list).getByRole('link', { name: 'REQ-12' })).toHaveAttribute(
      'href',
      '/requests/REQ-12',
    );
    expect(within(list).getByText(/Declined/)).toBeInTheDocument();
  });

  it('checks now and shows the IMAP error verbatim', async () => {
    mockApi({
      'GET /api/admin/mail/inbox': () => ({ json: configured }),
      'GET /api/admin/mail/inbox/messages': () => ({ json: [] }),
      'POST /api/admin/mail/inbox/poll': () => ({
        json: { ok: false, error: 'Invalid credentials (Failure)' },
      }),
    });
    await renderWithI18n(<IncomingMail />);
    await userEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid credentials (Failure)');
  });
});
