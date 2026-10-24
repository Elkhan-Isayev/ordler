import type { PersonalTokenView } from '@ordler/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { tokenState, TokensPage } from './TokensPage.js';

afterEach(() => vi.unstubAllGlobals());

const SETTINGS = { mcpEnabled: true, maxExpiryDays: 365, allowNoExpiry: false };

function token(overrides: Partial<PersonalTokenView> = {}): PersonalTokenView {
  return {
    id: 'tk1',
    name: 'Claude',
    prefix: 'ordl_pat_AbCd',
    scopes: ['read', 'issues:write'],
    expiresAt: '2027-01-19T09:00:00.000Z',
    lastUsedAt: null,
    lastUsedIp: null,
    revokedAt: null,
    createdAt: '2026-10-21T09:00:00.000Z',
    ...overrides,
  };
}

describe('TokensPage', () => {
  it('creates a token and shows the secret once', async () => {
    let tokens: PersonalTokenView[] = [];
    const calls = mockApi({
      'GET /api/me/tokens': () => ({ json: { tokens, settings: SETTINGS } }),
      'POST /api/me/tokens': () => {
        tokens = [token()];
        return { status: 201, json: { token: 'ordl_pat_AbCdsecret', view: tokens[0] } };
      },
    });
    await renderWithI18n(<TokensPage baseUrl="https://ordler.test" />);
    expect(await screen.findByText('No tokens yet.')).toBeInTheDocument();
    expect(screen.getByText('https://ordler.test/mcp')).toBeInTheDocument();
    expect(screen.getByText('https://ordler.test/api/v1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OpenAPI description' })).toHaveAttribute(
      'href',
      '/api/v1/openapi.json',
    );
    // Without an admin opt-in there is no "no expiry" choice.
    expect(screen.queryByRole('option', { name: 'No expiry' })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Name'), 'Claude');
    await userEvent.click(screen.getByLabelText(/Write issues/));
    await userEvent.selectOptions(screen.getByLabelText('Expires'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));

    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Claude',
      scopes: ['read', 'issues:write'],
      expiresInDays: 30,
    });
    expect(await screen.findByRole('status')).toHaveTextContent('It will not be shown again');
    expect(screen.getByText('ordl_pat_AbCdsecret')).toBeInTheDocument();
    expect(await screen.findByText('ordl_pat_AbCd…')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('ordl_pat_AbCdsecret')).not.toBeInTheDocument();
  });

  it('revokes a token', async () => {
    const calls = mockApi({
      'GET /api/me/tokens': () => ({ json: { tokens: [token()], settings: SETTINGS } }),
      'DELETE /api/me/tokens/tk1': () => ({ status: 204 }),
    });
    await renderWithI18n(<TokensPage />, 'ru');
    await userEvent.click(await screen.findByRole('button', { name: 'Отозвать Claude' }));
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/me/tokens/tk1')).toBe(true);
  });

  it('offers no expiry only when allowed, and warns when MCP is off', async () => {
    mockApi({
      'GET /api/me/tokens': () => ({
        json: {
          tokens: [],
          settings: { mcpEnabled: false, maxExpiryDays: 60, allowNoExpiry: true },
        },
      }),
    });
    await renderWithI18n(<TokensPage />);
    expect(await screen.findByText(/MCP is turned off/)).toBeInTheDocument();
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['30 days', 'No expiry']);
  });
});

describe('tokenState', () => {
  it('tells active, expired and revoked tokens apart', () => {
    const now = new Date('2026-12-01T00:00:00Z');
    expect(tokenState(token(), now)).toBe('active');
    expect(tokenState(token({ expiresAt: '2026-11-01T00:00:00Z' }), now)).toBe('expired');
    expect(tokenState(token({ revokedAt: '2026-11-01T00:00:00Z' }), now)).toBe('revoked');
    expect(tokenState(token({ expiresAt: null }), now)).toBe('active');
  });
});
