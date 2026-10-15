import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminStrategy } from '../api/client.js';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { AuthSection } from './AuthSection.js';
import { ROLES } from './fixtures.js';

afterEach(() => vi.unstubAllGlobals());

const strategy = (
  kind: AdminStrategy['kind'],
  extra: Partial<AdminStrategy> = {},
): AdminStrategy => ({
  kind,
  enabled: kind === 'local',
  usable: kind === 'local',
  position: 0,
  displayName: null,
  allowSelfRegistration: false,
  allowedDomains: [],
  defaultRoleId: null,
  config: {},
  hasClientSecret: false,
  callbackUrl: kind === 'google' ? 'https://ordler.test/api/auth/google/callback' : null,
  ...extra,
});

const base = {
  'GET /api/admin/auth/strategies': () => ({
    json: [
      strategy('local'),
      strategy('email_otp'),
      strategy('google', { hasClientSecret: true, config: { clientId: 'cid' } }),
    ],
  }),
  'GET /api/admin/roles': () => ({ json: ROLES }),
};

describe('AuthSection', () => {
  it('shows each strategy with its requirements and the Google redirect URI', async () => {
    mockApi(base);
    await renderWithI18n(<AuthSection />);
    expect(await screen.findByRole('form', { name: 'Email and password' })).toBeInTheDocument();
    expect(screen.getByText('Needs SMTP to be configured.')).toBeInTheDocument();
    expect(
      screen.getByDisplayValue('https://ordler.test/api/auth/google/callback'),
    ).toBeInTheDocument();
    expect(screen.getByText('Saved. Enter a new value to replace it.')).toBeInTheDocument();
  });

  it('saves Google settings and keeps the stored secret when the field is empty', async () => {
    const calls = mockApi({
      ...base,
      'PATCH /api/admin/auth/strategies/google': () => ({ json: {} }),
    });
    await renderWithI18n(<AuthSection />);
    const form = await screen.findByRole('form', { name: 'Google' });
    await userEvent.click(within(form).getByLabelText('Enabled'));
    await userEvent.click(within(form).getByLabelText('Allow self-registration'));
    await userEvent.type(
      within(form).getByLabelText('Allowed email domains'),
      'company.com, partner.org',
    );
    await userEvent.selectOptions(within(form).getByLabelText('Role for new accounts'), 'r-member');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toBeDefined());
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      enabled: true,
      allowSelfRegistration: true,
      allowedDomains: ['company.com', 'partner.org'],
      defaultRoleId: 'r-member',
      config: { clientId: 'cid' },
    });
    expect(await within(form).findByText('Saved')).toBeInTheDocument();
  });

  it('describes the stored secret without making it part of the field name', async () => {
    mockApi(base);
    await renderWithI18n(<AuthSection />);
    const form = await screen.findByRole('form', { name: 'Google' });
    expect(within(form).getByLabelText('Client secret')).toHaveAccessibleDescription(
      'Saved. Enter a new value to replace it.',
    );
  });

  it('sends a new secret only when one is typed and never offers the Owner role', async () => {
    const calls = mockApi({
      ...base,
      'PATCH /api/admin/auth/strategies/google': () => ({ json: {} }),
    });
    await renderWithI18n(<AuthSection />);
    const form = await screen.findByRole('form', { name: 'Google' });
    expect(
      within(within(form).getByLabelText('Role for new accounts')).queryByText('Owner'),
    ).toBeNull();
    await userEvent.type(within(form).getByLabelText('Client secret'), 'new-secret');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
        secrets: { clientSecret: 'new-secret' },
      }),
    );
  });

  it('explains lock-out protection', async () => {
    mockApi({
      ...base,
      'PATCH /api/admin/auth/strategies/local': () => ({
        status: 409,
        json: { error: 'lockout_prevented' },
      }),
    });
    await renderWithI18n(<AuthSection />);
    const form = await screen.findByRole('form', { name: 'Email and password' });
    await userEvent.click(within(form).getByLabelText('Enabled'));
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'This change would lock you out.',
    );
  });
});
