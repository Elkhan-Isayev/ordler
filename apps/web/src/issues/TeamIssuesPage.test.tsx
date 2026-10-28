import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { fakeRealtime } from '../test/realtime-fake.js';
import { renderWithI18n } from '../test/render.js';
import { detail, issue, TEAM } from './fixtures.js';
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

const base = (issues = [issue(2), issue(1, { statusId: 's-progress' })]) => ({
  'GET /api/teams/HELP': () => ({ json: TEAM }),
  'GET /api/teams/HELP/issues': () => ({ json: issues }),
});

describe('TeamIssuesPage', () => {
  it('shows a board column per status with its cards', async () => {
    mockApi(base());
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="board" />);
    const todo = await screen.findByRole('region', { name: 'Todo' });
    expect(within(todo).getByText('Issue 2')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'In Progress' })).getByText('HELP-1'),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Done' })).toHaveTextContent('0');
  });

  it('applies changes pushed by other people', async () => {
    mockApi(base());
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="board" />);
    await screen.findByText('Issue 2');
    act(() =>
      realtime.push({
        type: 'issue.changed',
        issue: issue(2, {
          statusId: 's-done',
          title: 'Issue 2 fixed',
          updatedAt: '2026-10-18T10:00:00.000Z',
        }),
      }),
    );
    const done = screen.getByRole('region', { name: 'Done' });
    expect(await within(done).findByText('Issue 2 fixed')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Todo' })).queryByText(/Issue 2/),
    ).not.toBeInTheDocument();
  });

  it('opens the issue menu on right click and applies the change', async () => {
    const calls = mockApi({
      ...base(),
      'PATCH /api/issues/HELP-2': () => ({ json: detail(2, { priority: 'high' }) }),
    });
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="board" />);
    fireEvent.contextMenu(await screen.findByText('Issue 2'));
    await userEvent.click(screen.getByRole('menuitem', { name: /Priority/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'High' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ priority: 'high' }),
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('drags the card, not the link, and marks it while moving', async () => {
    mockApi(base());
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="board" />);
    const link = (await screen.findByText('Issue 2')).closest('a')!;
    expect(link).toHaveAttribute('draggable', 'false');
    const item = link.closest('li')!;
    const dataTransfer = {
      setData: vi.fn(),
      getData: () => '',
      setDragImage: vi.fn(),
      effectAllowed: '',
    };
    fireEvent.dragStart(item, { dataTransfer });
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(
      item,
      expect.any(Number),
      expect.any(Number),
    );
    expect(item).toHaveClass('opacity-40');
    fireEvent.dragEnd(item);
    expect(item).not.toHaveClass('opacity-40');
  });

  it('drops issues deleted by other people', async () => {
    // Like the real server, later list requests no longer return the deleted issue, so a
    // reload that lands after the event (slow CI) cannot bring it back.
    let deleted = false;
    mockApi({
      ...base(),
      'GET /api/teams/HELP/issues': () => ({
        json: deleted
          ? [issue(1, { statusId: 's-progress' })]
          : base()['GET /api/teams/HELP/issues']().json,
      }),
    });
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="board" />);
    await screen.findByText('Issue 2');
    deleted = true;
    act(() => realtime.push({ type: 'issue.removed', issueId: 'i2', teamId: TEAM.id }));
    await waitFor(() => expect(screen.queryByText('Issue 2')).not.toBeInTheDocument());
    expect(screen.getByText('Issue 1')).toBeInTheDocument();
  });

  it('moves a card by drag and drop, optimistically', async () => {
    const calls = mockApi({
      ...base(),
      'PATCH /api/issues/HELP-2': () => ({
        json: issue(2, { statusId: 's-done', sortOrder: 0, updatedAt: '2026-10-18T10:00:00.000Z' }),
      }),
    });
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="board" />);
    const card = (await screen.findByText('Issue 2')).closest('li')!;
    const done = screen.getByRole('region', { name: 'Done' });
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
      effectAllowed: 'move',
    };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(done, { dataTransfer });
    expect(within(done).getByText('Issue 2')).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        statusId: 's-done',
        sortOrder: 0,
      }),
    );
  });

  it('rolls back when the server refuses a move', async () => {
    mockApi({
      ...base(),
      'PATCH /api/issues/HELP-2': () => ({ status: 403, json: { error: 'forbidden' } }),
    });
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="board" />);
    const card = (await screen.findByText('Issue 2')).closest('li')!;
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
    };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(screen.getByRole('region', { name: 'Done' }), { dataTransfer });
    expect(await screen.findByRole('alert')).toHaveTextContent('permission');
    expect(
      within(screen.getByRole('region', { name: 'Todo' })).getByText('Issue 2'),
    ).toBeInTheDocument();
  });

  it('creates an issue in the chosen column', async () => {
    const calls = mockApi({
      ...base([]),
      'POST /api/teams/HELP/issues': () => ({
        status: 201,
        json: detail(3, { statusId: 's-progress' }),
      }),
    });
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="board" />);
    await userEvent.click(await screen.findByRole('button', { name: 'New issue in In Progress' }));
    const dialog = screen.getByRole('dialog', { name: 'New issue in Helpdesk' });
    await userEvent.type(within(dialog).getByLabelText('Issue title'), 'Replace toner');
    await userEvent.selectOptions(within(dialog).getByLabelText('Assignee'), 'm-bob');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create issue' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      title: 'Replace toner',
      statusId: 's-progress',
      assigneeId: 'm-bob',
    });
    expect(
      within(screen.getByRole('region', { name: 'In Progress' })).getByText('Issue 3'),
    ).toBeInTheDocument();
  });

  it('hides creation and dragging from viewers', async () => {
    mockApi({
      ...base(),
      'GET /api/teams/HELP': () => ({
        json: { ...TEAM, can: { create: false, update: false, assign: false, comment: false } },
      }),
    });
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="board" />);
    const card = (await screen.findByText('Issue 2')).closest('li')!;
    expect(card).toHaveAttribute('draggable', 'false');
    expect(screen.queryByRole('button', { name: 'New issue' })).not.toBeInTheDocument();
  });

  it('lists issues grouped by status', async () => {
    mockApi(base());
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="list" />);
    const progress = await screen.findByRole('region', { name: 'In Progress' });
    expect(within(progress).getByRole('link', { name: /HELP-1/ })).toHaveAttribute(
      'href',
      '/issue/HELP-1',
    );
    expect(screen.queryByRole('region', { name: 'Done' })).not.toBeInTheDocument();
  });

  it('explains a team that does not exist or is hidden', async () => {
    mockApi({
      'GET /api/teams/NOPE': () => ({ status: 404, json: { error: 'not_found' } }),
      'GET /api/teams/NOPE/issues': () => ({ status: 404, json: { error: 'not_found' } }),
    });
    await renderWithI18n(<TeamIssuesPage teamKey="NOPE" view="board" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('filters by label and priority and keeps filters in the URL', async () => {
    const bug = { id: 'l-bug', name: 'Bug', color: '#e5484d' };
    mockApi(
      base([
        issue(1, { title: 'Crash', labels: [bug], priority: 'high' }),
        issue(2, { title: 'Typo', priority: 'high' }),
        issue(3, { title: 'Slow', labels: [bug] }),
      ]),
    );
    window.history.replaceState(null, '', '/teams/HELP/issues?priority=high');
    await renderWithI18n(<TeamIssuesPage teamKey="HELP" view="list" />);
    expect(await screen.findByText('Crash')).toBeInTheDocument();
    expect(screen.getByText('Typo')).toBeInTheDocument();
    expect(screen.queryByText('Slow')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Labels' }), 'l-bug');
    expect(screen.queryByText('Typo')).not.toBeInTheDocument();
    expect(window.location.search).toBe('?priority=high&label=l-bug');

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Slow')).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });
});
