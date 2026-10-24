import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { DatabaseSetupPage } from './DatabaseSetupPage.js';

afterEach(() => vi.unstubAllGlobals());

async function fill() {
  const form = await screen.findByRole('form', { name: 'Connect a database' });
  const field = (label: string) => within(form).getByLabelText(label);
  await userEvent.type(field('Host'), 'db.push30.test');
  await userEvent.type(field('Password'), 'db-secret');
  await userEvent.selectOptions(field('Encryption (SSL)'), 'require');
  await userEvent.type(field('Install token'), 'K7QX-2M9P-WD4T');
  return form;
}

const EXPECTED = {
  host: 'db.push30.test',
  port: 5432,
  database: 'ordler',
  user: 'ordler',
  password: 'db-secret',
  ssl: 'require',
  schema: 'public',
  installToken: 'K7QX-2M9P-WD4T',
};

describe('DatabaseSetupPage', () => {
  it('tests the connection and shows the server version', async () => {
    const calls = mockApi({
      'POST /api/install/database/test': () => ({ json: { ok: true, serverVersion: '18.1' } }),
    });
    await renderWithI18n(<DatabaseSetupPage onReady={vi.fn()} />);
    const form = await fill();
    await userEvent.click(within(form).getByRole('button', { name: 'Test connection' }));
    expect(await within(form).findByRole('status')).toHaveTextContent(
      'Connected to PostgreSQL 18.1.',
    );
    expect(calls[0]!.body).toEqual(EXPECTED);
  });

  it('explains a failed connection with the server message', async () => {
    mockApi({
      'POST /api/install/database/test': () => ({
        json: {
          ok: false,
          error: 'insufficient_privileges',
          detail: 'GRANT CREATE ON DATABASE ordler TO ordler;',
        },
      }),
    });
    await renderWithI18n(<DatabaseSetupPage onReady={vi.fn()} />);
    const form = await fill();
    await userEvent.click(within(form).getByRole('button', { name: 'Test connection' }));
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent('may not create tables');
    expect(alert).toHaveTextContent('GRANT CREATE ON DATABASE ordler TO ordler;');
  });

  it('asks for the CA certificate when verifying the server', async () => {
    await renderWithI18n(<DatabaseSetupPage onReady={vi.fn()} />);
    const form = await screen.findByRole('form', { name: 'Connect a database' });
    expect(within(form).queryByLabelText(/CA certificate/)).not.toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText('Encryption (SSL)'), 'verify-full');
    expect(within(form).getByLabelText(/CA certificate/)).toBeRequired();
  });

  it('saves, waits for Ordler to start and continues', async () => {
    let started = false;
    mockApi({
      'POST /api/install/database': () => ({ json: { ok: true, serverVersion: '18.1' } }),
      'GET /api/setup/status': () =>
        started
          ? { json: { setupRequired: true } }
          : { json: { setupRequired: true, databaseRequired: true } },
    });
    const onReady = vi.fn();
    await renderWithI18n(<DatabaseSetupPage onReady={onReady} pollMs={10} />);
    const form = await fill();
    await userEvent.click(within(form).getByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByText(/starting Ordler/)).toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
    started = true;
    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  });

  it('shows a wrong install token', async () => {
    mockApi({
      'POST /api/install/database': () => ({
        status: 403,
        json: { error: 'invalid_install_token' },
      }),
    });
    await renderWithI18n(<DatabaseSetupPage onReady={vi.fn()} />);
    const form = await fill();
    await userEvent.click(within(form).getByRole('button', { name: 'Save and continue' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('install token is wrong');
  });
});
