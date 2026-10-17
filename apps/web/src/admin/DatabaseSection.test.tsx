import type { DatabaseSettingsView } from '@ordler/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { DatabaseSection } from './DatabaseSection.js';

afterEach(() => vi.unstubAllGlobals());

const FILE: DatabaseSettingsView = {
  source: 'file',
  host: 'db.push30.test',
  port: 5432,
  database: 'ordler',
  user: 'ordler',
  ssl: 'require',
  schema: 'ordler',
  passwordSet: true,
  serverVersion: '18.1',
};

describe('DatabaseSection', () => {
  it('shows the connection without secrets', async () => {
    mockApi({ 'GET /api/admin/database': () => ({ json: { ...FILE, source: 'env' } }) });
    await renderWithI18n(<DatabaseSection canEdit />);
    expect(await screen.findByText('db.push30.test')).toBeInTheDocument();
    expect(screen.getByText('18.1')).toBeInTheDocument();
    expect(screen.getByText(/DATABASE_URL or DB_\*/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Change connection' })).not.toBeInTheDocument();
  });

  it('lets the Owner change installer settings and asks for a restart', async () => {
    const calls = mockApi({
      'GET /api/admin/database': () => ({ json: FILE }),
      'PUT /api/admin/database': () => ({ json: { saved: true, restartRequired: true } }),
    });
    await renderWithI18n(<DatabaseSection canEdit />);
    const form = await screen.findByRole('form', { name: 'Change connection' });
    const host = within(form).getByLabelText('Host');
    await userEvent.clear(host);
    await userEvent.type(host, 'new-db.push30.test');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));

    expect(await within(form).findByRole('status')).toHaveTextContent('Restart Ordler');
    const body = calls.find((c) => c.method === 'PUT')!.body;
    expect(body).toMatchObject({ host: 'new-db.push30.test', ssl: 'require' });
    // An empty password field keeps the stored password.
    expect(body).not.toHaveProperty('password');
  });

  it('shows why new settings were not saved', async () => {
    mockApi({
      'GET /api/admin/database': () => ({ json: FILE }),
      'PUT /api/admin/database': () => ({
        json: { saved: false, error: 'authentication_failed', detail: 'bad password' },
      }),
    });
    await renderWithI18n(<DatabaseSection canEdit />);
    const form = await screen.findByRole('form', { name: 'Change connection' });
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('password is wrong');
  });

  it('hides the form from admins who are not Owners', async () => {
    mockApi({ 'GET /api/admin/database': () => ({ json: FILE }) });
    await renderWithI18n(<DatabaseSection canEdit={false} />);
    expect(await screen.findByText('db.push30.test')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Change connection' })).not.toBeInTheDocument();
  });
});
