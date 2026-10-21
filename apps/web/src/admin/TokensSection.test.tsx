import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { TokensSection } from './TokensSection.js';

afterEach(() => vi.unstubAllGlobals());

describe('TokensSection', () => {
  it('turns MCP off, changes limits and revokes a member’s token', async () => {
    const calls = mockApi({
      'GET /api/admin/tokens': () => ({
        json: {
          settings: { mcpEnabled: true, maxExpiryDays: 365, allowNoExpiry: false },
          tokens: [
            {
              id: 'tk1',
              name: 'Cursor',
              prefix: 'ordl_pat_Zz9y',
              scopes: ['read'],
              expiresAt: null,
              lastUsedAt: '2026-10-21T09:00:00.000Z',
              lastUsedIp: '10.0.0.7',
              revokedAt: null,
              createdAt: '2026-10-20T09:00:00.000Z',
              member: { id: 'm2', name: 'Rauf' },
            },
          ],
        },
      }),
      'PUT /api/admin/tokens/settings': (body) => ({ json: body }),
      'DELETE /api/admin/tokens/tk1': () => ({ status: 204 }),
    });
    await renderWithI18n(<TokensSection />);
    expect(await screen.findByText('Rauf')).toBeInTheDocument();
    expect(screen.getByText(/10\.0\.0\.7/)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Enable the MCP server'));
    const max = screen.getByLabelText(/Longest allowed expiry/);
    await userEvent.clear(max);
    await userEvent.type(max, '90');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      mcpEnabled: false,
      maxExpiryDays: 90,
      allowNoExpiry: false,
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');

    await userEvent.click(screen.getByRole('button', { name: 'Revoke Cursor' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });
});
