import type { SlackAppView } from '@ordler/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { SlackAppPanel } from './SlackAppPanel.js';

afterEach(() => vi.unstubAllGlobals());

const EMPTY: SlackAppView = {
  enabled: false,
  mode: 'socket',
  workspace: null,
  botTokenSet: false,
  appTokenSet: false,
  signingSecretSet: false,
  clientId: null,
  clientSecretSet: false,
  connection: 'disconnected',
  lastError: null,
  linkedMembers: 0,
  urls: {
    redirect: 'https://ordler.test/api/me/slack/callback',
    events: 'https://ordler.test/api/slack/events',
    interactivity: 'https://ordler.test/api/slack/interactivity',
  },
};

describe('SlackAppPanel', () => {
  it('shows the manifest and saves only the tokens that were typed', async () => {
    const calls = mockApi({
      'GET /api/admin/slack-app': () => ({ json: EMPTY }),
      'GET /api/admin/slack-app/manifest': () => ({
        json: { display_information: { name: 'Ordler' } },
      }),
      'PUT /api/admin/slack-app': () => ({
        json: {
          ...EMPTY,
          enabled: true,
          workspace: { id: 'T1', name: 'Push30' },
          botTokenSet: true,
        },
      }),
    });
    await renderWithI18n(<SlackAppPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show manifest' }));
    expect(((await screen.findByLabelText('App manifest')) as HTMLTextAreaElement).value).toContain(
      '"name": "Ordler"',
    );
    // Socket Mode needs the app token, not the signing secret.
    expect(screen.queryByLabelText('Signing secret')).toBeNull();

    await userEvent.click(screen.getByLabelText('Enabled'));
    await userEvent.type(screen.getByLabelText('Bot token (xoxb-…)'), 'xoxb-1');
    await userEvent.type(screen.getByLabelText('App-level token (xapp-…)'), 'xapp-1');
    await userEvent.click(screen.getByRole('button', { name: 'Save Slack app' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        enabled: true,
        mode: 'socket',
        clientId: null,
        botToken: 'xoxb-1',
        appToken: 'xapp-1',
      }),
    );
    expect(await screen.findByText('Workspace: Push30', { exact: false })).toBeInTheDocument();
  });

  it('asks for the signing secret and shows request URLs in HTTPS mode', async () => {
    mockApi({ 'GET /api/admin/slack-app': () => ({ json: EMPTY }) });
    await renderWithI18n(<SlackAppPanel />);
    await userEvent.click(await screen.findByLabelText('HTTPS request URLs'));
    expect(screen.getByLabelText('Signing secret')).toBeInTheDocument();
    expect(screen.getByText('https://ordler.test/api/slack/events')).toBeInTheDocument();
  });
});
