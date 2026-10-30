import type { SavedView } from '@ordler/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { ViewsPage } from './ViewsPage.js';

afterEach(() => vi.unstubAllGlobals());

const view = (id: string, overrides: Partial<SavedView> = {}): SavedView => ({
  id,
  name: `View ${id}`,
  layout: 'board',
  filters: { priority: 'high', assignee: 'none' },
  shared: false,
  team: { id: 't1', key: 'HELP', name: 'Helpdesk' },
  owner: { id: 'm1', name: 'Ann Lee' },
  canEdit: true,
  createdAt: '2026-10-20T09:00:00.000Z',
  updatedAt: '2026-10-20T09:00:00.000Z',
  ...overrides,
});

describe('ViewsPage', () => {
  it('lists views across teams and links each to its layout and filters', async () => {
    mockApi({
      'GET /api/views': () => ({
        json: [view('a'), view('b', { shared: true, layout: 'timeline', filters: {} })],
      }),
    });
    await renderWithI18n(<ViewsPage />);
    const mine = await screen.findByRole('link', { name: /View a/ });
    expect(mine).toHaveAttribute('href', '/teams/HELP/board?assignee=none&priority=high&view=a');
    expect(mine).toHaveTextContent('Personal');
    expect(mine).toHaveTextContent('2 filters');
    expect(screen.getByRole('link', { name: /View b/ })).toHaveTextContent(
      /Shared.*Timeline.*No filters/,
    );
  });

  it('deletes only views the member may edit', async () => {
    const calls = mockApi({
      'GET /api/teams/HELP/views': () => ({
        json: [view('a'), view('b', { shared: true, canEdit: false })],
      }),
      'DELETE /api/views/a': () => ({ status: 204 }),
    });
    vi.stubGlobal('confirm', () => true);
    await renderWithI18n(<ViewsPage teamKey="HELP" />);
    await screen.findByText('View a');
    expect(screen.queryByRole('button', { name: 'Delete view View b' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete view View a' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('explains how to create the first view', async () => {
    mockApi({ 'GET /api/views': () => ({ json: [] }) });
    await renderWithI18n(<ViewsPage />);
    expect(await screen.findByText(/No saved views yet/)).toBeInTheDocument();
  });
});
