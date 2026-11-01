import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { OAuthConsentPage } from './OAuthConsentPage.js';

afterEach(() => vi.unstubAllGlobals());

const SEARCH =
  '?response_type=code&client_id=oc_1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&code_challenge=c&code_challenge_method=S256&state=s1';

const CONSENT = `GET /api/oauth/consent?${new URLSearchParams(SEARCH).toString()}`;

const VIEW = {
  client: { id: 'oc_1', name: 'Claude' },
  redirectHost: 'claude.ai',
  scopes: ['read', 'issues:write'],
};

describe('OAuthConsentPage', () => {
  it('shows who asks and sends the narrowed scopes with the original request', async () => {
    const go = vi.fn();
    const calls = mockApi({
      [CONSENT]: () => ({ json: VIEW }),
      'POST /api/oauth/consent': () => ({ json: { redirect: 'https://claude.ai/cb?code=x' } }),
    });
    await renderWithI18n(<OAuthConsentPage search={SEARCH} go={go} />);
    expect(await screen.findByText('Claude wants to work in Ordler as you.')).toBeInTheDocument();
    expect(screen.getByText('After you decide, you go back to claude.ai.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Write issues/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));

    await waitFor(() => expect(go).toHaveBeenCalledWith('https://claude.ai/cb?code=x'));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      client_id: 'oc_1',
      state: 's1',
      approve: true,
      scopes: ['read'],
    });
  });

  it('denies and explains an invalid link', async () => {
    const go = vi.fn();
    mockApi({
      [CONSENT]: () => ({ json: VIEW }),
      'POST /api/oauth/consent': () => ({
        json: { redirect: 'https://claude.ai/cb?error=access_denied' },
      }),
    });
    await renderWithI18n(<OAuthConsentPage search={SEARCH} go={go} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    await waitFor(() =>
      expect(go).toHaveBeenCalledWith('https://claude.ai/cb?error=access_denied'),
    );
  });

  it('shows why a broken request cannot be approved', async () => {
    mockApi({
      [CONSENT]: () => ({ status: 400, json: { error: 'oauth_invalid_request' } }),
    });
    await renderWithI18n(<OAuthConsentPage search={SEARCH} />);
    expect(
      await screen.findByText(
        'This authorization link is not valid. Start the connection again from your app.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });
});
