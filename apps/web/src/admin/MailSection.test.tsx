import type { MailSettingsView } from '@ordler/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { MailSection } from './MailSection.js';

afterEach(() => vi.unstubAllGlobals());

const NONE: MailSettingsView = {
  source: 'none',
  host: null,
  port: 587,
  security: 'starttls',
  verifyTls: true,
  username: null,
  passwordSet: false,
  fromName: null,
  fromEmail: null,
};

const SAVED: MailSettingsView = {
  ...NONE,
  source: 'database',
  host: 'smtp.push30.test',
  username: 'ordler',
  passwordSet: true,
  fromName: 'Push30',
  fromEmail: 'tasks@push30.test',
};

const render = () => renderWithI18n(<MailSection defaultTestRecipient="owner@push30.test" />, 'en');

describe('MailSection', () => {
  it('saves SMTP settings entered by the admin', async () => {
    const calls = mockApi({
      'GET /api/admin/mail': () => ({ json: NONE }),
      'PUT /api/admin/mail': () => ({ json: SAVED }),
    });
    await render();
    expect(await screen.findByText(/Mail is not configured yet/)).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'Mail server' });
    await userEvent.type(within(form).getByLabelText('SMTP host'), 'smtp.push30.test');
    await userEvent.type(within(form).getByLabelText('Username'), 'ordler');
    await userEvent.type(within(form).getByLabelText('Password'), 'smtp-secret');
    await userEvent.type(within(form).getByLabelText('Sender email'), 'tasks@push30.test');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    // The typed password does not linger in the form after saving.
    expect(within(form).getByLabelText('Password')).toHaveValue('');
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      host: 'smtp.push30.test',
      port: 587,
      security: 'starttls',
      verifyTls: true,
      username: 'ordler',
      password: 'smtp-secret',
      fromName: null,
      fromEmail: 'tasks@push30.test',
    });
  });

  it('keeps the stored password when the field is left empty', async () => {
    const calls = mockApi({
      'GET /api/admin/mail': () => ({ json: SAVED }),
      'PUT /api/admin/mail': () => ({ json: SAVED }),
    });
    await render();
    const form = await screen.findByRole('form', { name: 'Mail server' });
    expect(within(form).getByLabelText('Password')).toHaveAccessibleDescription(
      'Saved. Enter a new value to replace it.',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await screen.findByRole('status');
    expect(calls.find((c) => c.method === 'PUT')!.body).not.toHaveProperty('password');
  });

  it('shows environment-provided settings read-only', async () => {
    mockApi({
      'GET /api/admin/mail': () => ({
        json: { ...SAVED, source: 'env', fromName: null, fromEmail: 'Ordler <no-reply@env.test>' },
      }),
    });
    await render();
    expect(await screen.findByText(/SMTP_\* environment variables/)).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'Mail server' });
    expect(within(form).getByLabelText('SMTP host')).toBeDisabled();
    expect(within(form).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('sends a test email and shows the SMTP error when it fails', async () => {
    let attempt = 0;
    mockApi({
      'GET /api/admin/mail': () => ({ json: SAVED }),
      'POST /api/admin/mail/test': () =>
        attempt++ === 0
          ? { json: { sent: true } }
          : { json: { sent: false, error: '535 Authentication failed' } },
    });
    await render();
    const test = await screen.findByRole('form', { name: 'Send a test email' });
    expect(within(test).getByLabelText('Recipient')).toHaveValue('owner@push30.test');
    await userEvent.click(within(test).getByRole('button', { name: 'Send' }));
    expect(await within(test).findByRole('status')).toHaveTextContent('Sent');

    await userEvent.click(within(test).getByRole('button', { name: 'Send' }));
    expect(await within(test).findByRole('alert')).toHaveTextContent('535 Authentication failed');
  });
});
