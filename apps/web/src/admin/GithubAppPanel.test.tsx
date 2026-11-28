import type { GithubAppView } from '@ordler/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { GithubAppPanel } from './GithubAppPanel.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const EMPTY: GithubAppView = {
  enabled: false,
  githubUrl: 'https://github.com',
  organization: null,
  appId: null,
  appSlug: null,
  privateKeySet: false,
  webhookSecretSet: false,
  installUrl: null,
  webhookUrl: 'https://ordler.test/api/github/webhook',
  lastDeliveryAt: null,
  lastError: null,
};

const CONNECTED: GithubAppView = {
  ...EMPTY,
  enabled: true,
  appId: '42',
  appSlug: 'ordler-acme',
  privateKeySet: true,
  webhookSecretSet: true,
  installUrl: 'https://github.com/apps/ordler-acme/installations/new',
};

describe('GithubAppPanel', () => {
  it('starts the manifest flow and posts the manifest to GitHub', async () => {
    const calls = mockApi({
      'GET /api/admin/github-app': () => ({ json: EMPTY }),
      'POST /api/admin/github-app/manifest': () => ({
        json: {
          url: 'https://ghe.acme.test/organizations/acme/settings/apps/new?state=s',
          manifest: '{"name":"Ordler"}',
        },
      }),
    });
    const submit = vi.fn();
    await renderWithI18n(<GithubAppPanel submit={submit} />);
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    const create = screen.getByRole('form', { name: 'Create GitHub App' });
    const url = create.querySelector('input[name="githubUrl"]') as HTMLInputElement;
    await userEvent.clear(url);
    await userEvent.type(url, 'https://ghe.acme.test');
    await userEvent.type(
      create.querySelector('input[name="organization"]') as HTMLInputElement,
      'acme',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create GitHub App' }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        'https://ghe.acme.test/organizations/acme/settings/apps/new?state=s',
        '{"name":"Ordler"}',
      ),
    );
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      githubUrl: 'https://ghe.acme.test',
      organization: 'acme',
    });
  });

  it('saves manual details and sends only the secrets that were typed', async () => {
    const calls = mockApi({
      'GET /api/admin/github-app': () => ({ json: EMPTY }),
      'PUT /api/admin/github-app': () => ({ json: CONNECTED }),
    });
    await renderWithI18n(<GithubAppPanel />);
    await userEvent.click(await screen.findByText('Enter app details manually'));
    await userEvent.click(screen.getByLabelText('Enabled'));
    await userEvent.type(screen.getByLabelText('App ID'), '42');
    await userEvent.type(screen.getByLabelText('Webhook secret'), 'secret-0123456789abc');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        enabled: true,
        githubUrl: 'https://github.com',
        organization: null,
        appId: '42',
        webhookSecret: 'secret-0123456789abc',
      }),
    );
    expect(
      await screen.findByText('Connected as GitHub App “ordler-acme”', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install the app' })).toHaveAttribute(
      'href',
      CONNECTED.installUrl,
    );
    expect((screen.getByLabelText('Webhook secret') as HTMLInputElement).value).toBe('');
  });

  it('reports the result of the manifest callback', async () => {
    window.history.replaceState(null, '', '/admin/integrations?github_error=github_rejected');
    mockApi({ 'GET /api/admin/github-app': () => ({ json: EMPTY }) });
    await renderWithI18n(<GithubAppPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub rejected the request');
  });

  it('disconnects by clearing the app id and secrets', async () => {
    const calls = mockApi({
      'GET /api/admin/github-app': () => ({ json: CONNECTED }),
      'PUT /api/admin/github-app': () => ({ json: EMPTY }),
    });
    await renderWithI18n(<GithubAppPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        enabled: false,
        githubUrl: 'https://github.com',
        appId: null,
        privateKey: null,
        webhookSecret: null,
      }),
    );
  });
});
