import type { SavedView } from '@ordler/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { fakeRealtime } from '../test/realtime-fake.js';
import { renderWithI18n } from '../test/render.js';
import { issue, TEAM } from './fixtures.js';
import { layoutHref } from './SavedViews.js';
import { TeamIssuesPage } from './TeamIssuesPage.js';

let realtime: ReturnType<typeof fakeRealtime>;
beforeEach(() => {
  realtime = fakeRealtime();
});
afterEach(() => {
  realtime.reset();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const URGENT: SavedView = {
  id: 'v-urgent',
  name: 'Urgent',
  layout: 'list',
  filters: { priority: 'urgent' },
  shared: true,
  team: { id: TEAM.id, key: 'HELP', name: 'Helpdesk' },
  owner: { id: 'm-ann', name: 'Ann Lee' },
  canEdit: true,
  createdAt: '2026-10-20T09:00:00.000Z',
  updatedAt: '2026-10-20T09:00:00.000Z',
};

const ISSUES = [
  issue(1, { title: 'Server down', priority: 'urgent', dueDate: '2026-11-03' }),
  issue(2, { title: 'Typo on page', priority: 'low' }),
];

function api(views: SavedView[] = [URGENT], team = TEAM) {
  return mockApi({
    'GET /api/teams/HELP': () => ({ json: team }),
    'GET /api/teams/HELP/issues': () => ({ json: ISSUES }),
    'GET /api/teams/HELP/views': () => ({ json: views }),
    'POST /api/teams/HELP/views': (body) => ({
      status: 201,
      json: { ...URGENT, id: 'v-new', shared: false, ...(body as object) },
    }),
    'PATCH /api/views/v-urgent': (body) => ({ json: { ...URGENT, ...(body as object) } }),
  });
}

describe('layoutHref', () => {
  it('puts the layout in the path and filters and view in the query', () => {
    expect(layoutHref('HELP', 'timeline', { priority: 'high' }, 'v1')).toBe(
      '/teams/HELP/timeline?priority=high&view=v1',
    );
    expect(layoutHref('HELP', 'list', {}, 'v1')).toBe('/teams/HELP/issues?view=v1');
    expect(layoutHref('HELP', 'board', {})).toBe('/teams/HELP/board');
  });
});

describe('saved views on the team page (SPEC §5.4)', () => {
  it('opens a saved view with its filters', async () => {
    api();
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="list" />);
    await screen.findByText('Typo on page');
    const picker = screen.getByRole('combobox', { name: 'Saved view' });
    await waitFor(() =>
      expect(within(picker).getByRole('option', { name: 'Urgent' })).toBeInTheDocument(),
    );

    await userEvent.selectOptions(picker, 'v-urgent');
    expect(screen.queryByText('Typo on page')).not.toBeInTheDocument();
    expect(screen.getByText('Server down')).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe(
      '/teams/HELP/issues?priority=urgent&view=v-urgent',
    );
  });

  it('saves changed filters back into an editable view', async () => {
    const calls = api();
    window.history.replaceState(null, '', '/teams/HELP/issues?priority=urgent&view=v-urgent');
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="list" />);
    await screen.findByText('Server down');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), 'low');
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        layout: 'list',
        filters: { priority: 'low' },
      }),
    );
  });

  it('does not offer to overwrite a view the member may not edit', async () => {
    api([{ ...URGENT, canEdit: false }]);
    window.history.replaceState(null, '', '/teams/HELP/issues?priority=low&view=v-urgent');
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="list" />);
    await screen.findByText('Typo on page');
    const picker = screen.getByRole('combobox', { name: 'Saved view' });
    await waitFor(() => expect(picker).toHaveValue('v-urgent'));
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('saves the current filters as a personal view; sharing needs the permission', async () => {
    const calls = api([]);
    window.history.replaceState(null, '', '/teams/HELP/board?priority=urgent');
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="board" />);
    await screen.findByText('Server down');
    await userEvent.click(screen.getByRole('button', { name: 'Save as view' }));
    const dialog = screen.getByRole('dialog', { name: 'Save as view' });
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'View name' }), 'Fires');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        name: 'Fires',
        shared: false,
        layout: 'board',
        filters: { priority: 'urgent' },
      }),
    );
    expect(window.location.search).toBe('?priority=urgent&view=v-new');
  });

  it('lets members with the permission share a new view', async () => {
    const calls = api([], { ...TEAM, can: { ...TEAM.can, shareViews: true } });
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="list" />);
    await screen.findByText('Server down');
    await userEvent.click(screen.getByRole('button', { name: 'Save as view' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'View name' }), 'Team');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Share with the team' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ shared: true }),
    );
  });
});

describe('timeline layout', () => {
  it('draws issues with a due date and lists the rest underneath', async () => {
    api([]);
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="timeline" />);
    const timeline = await screen.findByRole('region', { name: 'Timeline' });
    expect(
      within(timeline).getByRole('link', { name: /Server down: Oct 18, 2026 – Nov 3, 2026/ }),
    ).toHaveAttribute('href', '/issue/HELP-1');
    const undated = screen.getByRole('region', { name: 'No due date' });
    expect(within(undated).getByText('Typo on page')).toBeInTheDocument();
    expect(within(timeline).queryByText('Typo on page')).not.toBeInTheDocument();
  });
});
