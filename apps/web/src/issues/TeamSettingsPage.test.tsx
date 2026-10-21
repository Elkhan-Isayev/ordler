import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { STATUSES, TEAM } from './fixtures.js';
import { moveStatus, TeamSettingsPage } from './TeamSettingsPage.js';

afterEach(() => vi.unstubAllGlobals());

const base = {
  'GET /api/teams/HELP': () => ({ json: TEAM }),
  'GET /api/integrations/slack': () => ({ json: [] }),
};

describe('moveStatus', () => {
  it('swaps only with a neighbour of the same category', () => {
    const statuses = [
      ...STATUSES,
      {
        id: 's-review',
        key: null,
        name: 'Review',
        category: 'started' as const,
        position: 4,
        isDefault: false,
      },
    ];
    const order = moveStatus(statuses, 's-review', -1);
    expect(order).toEqual(['s-backlog', 's-todo', 's-review', 's-done', 's-progress']);
    // Todo is alone in its category: nothing moves.
    expect(moveStatus(statuses, 's-todo', -1)).toEqual(statuses.map((s) => s.id));
  });
});

describe('TeamSettingsPage', () => {
  it('adds, renames, sets the default and archives statuses', async () => {
    const calls = mockApi({
      ...base,
      'POST /api/teams/HELP/statuses': () => ({ status: 201, json: STATUSES }),
      'PATCH /api/statuses/s-progress': () => ({ json: STATUSES }),
      'PATCH /api/statuses/s-backlog': () => ({ json: STATUSES }),
      'DELETE /api/statuses/s-done': () => ({ status: 409, json: { error: 'status_required' } }),
    });
    await renderWithI18n(<TeamSettingsPage teamKey="HELP" />);
    const form = await screen.findByRole('form', { name: 'Add status' });
    await userEvent.type(within(form).getByLabelText('New status'), 'QA');
    await userEvent.click(within(form).getByRole('button', { name: 'Add status' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'QA',
      category: 'started',
    });

    const name = screen.getByLabelText('Name of In Progress');
    await userEvent.clear(name);
    await userEvent.type(name, 'Doing');
    await userEvent.tab();
    expect(calls.find((c) => c.path === '/api/statuses/s-progress')!.body).toEqual({
      name: 'Doing',
    });

    const backlog = screen.getByRole('region', { name: 'Backlog' });
    await userEvent.click(within(backlog).getByRole('radio', { name: 'Default' }));
    expect(calls.find((c) => c.path === '/api/statuses/s-backlog')!.body).toEqual({
      isDefault: true,
    });

    await userEvent.click(screen.getByRole('button', { name: 'Archive Done' }));
    expect(await screen.findByText(/This status is required/)).toBeInTheDocument();
  });

  it('renames team labels and leaves organization labels alone', async () => {
    const calls = mockApi({
      ...base,
      'PATCH /api/labels/l-bug': () => ({ json: {} }),
      'DELETE /api/labels/l-bug': () => ({ status: 204 }),
    });
    await renderWithI18n(<TeamSettingsPage teamKey="HELP" />, 'ru');
    const name = await screen.findByLabelText('Название метки Bug');
    await userEvent.clear(name);
    await userEvent.type(name, 'Defect');
    await userEvent.tab();
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      name: 'Defect',
      color: '#e5484d',
    });
    expect(screen.getByLabelText('Название метки Security')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Удалить Bug' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });
});
