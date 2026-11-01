import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { SlackPage } from './SlackPage.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('SlackPage', () => {
  it('offers to link when the app is connected', async () => {
    mockApi({
      'GET /api/me/slack': () => ({
        json: { available: true, linked: false, workspace: 'Push30', directMessages: true },
      }),
    });
    await renderWithI18n(<SlackPage />);
    expect(
      await screen.findByRole('link', { name: 'Link Slack account (Push30)' }),
    ).toHaveAttribute('href', '/api/me/slack/start');
  });

  it('explains when the admin has not connected Slack', async () => {
    mockApi({
      'GET /api/me/slack': () => ({
        json: { available: false, linked: false, workspace: null, directMessages: true },
      }),
    });
    await renderWithI18n(<SlackPage />);
    expect(
      await screen.findByText('Your administrator has not connected the Slack app yet.'),
    ).toBeInTheDocument();
  });

  it('turns DMs off and unlinks a linked account', async () => {
    let link = { available: true, linked: true, workspace: 'Push30', directMessages: true };
    const calls = mockApi({
      'GET /api/me/slack': () => ({ json: link }),
      'PATCH /api/me/slack': (body) => {
        link = { ...link, ...(body as object) };
        return { json: link };
      },
      'DELETE /api/me/slack': () => {
        link = { ...link, linked: false };
        return { status: 204 };
      },
    });
    await renderWithI18n(<SlackPage />);
    await userEvent.click(await screen.findByLabelText('Send my Inbox events as direct messages'));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ directMessages: false }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Unlink Slack' }));
    expect(await screen.findByRole('link', { name: /Link Slack account/ })).toBeInTheDocument();
  });

  it('shows the result of the Slack sign-in', async () => {
    window.history.replaceState(null, '', '/settings/slack?slack_error=oauth_failed');
    mockApi({
      'GET /api/me/slack': () => ({
        json: { available: true, linked: false, workspace: 'Push30', directMessages: true },
      }),
    });
    await renderWithI18n(<SlackPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
