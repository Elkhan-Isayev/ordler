import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { fakeRealtime } from '../test/realtime-fake.js';
import { renderWithI18n } from '../test/render.js';
import { detail, issue, TEAM } from './fixtures.js';
import { describeEvent, IssuePage } from './IssuePage.js';
import { createI18n } from '../i18n/index.js';

let realtime: ReturnType<typeof fakeRealtime>;
beforeEach(() => {
  realtime = fakeRealtime();
});
afterEach(() => {
  realtime.reset();
  vi.unstubAllGlobals();
});

describe('IssuePage', () => {
  it('shows the issue, its properties and history', async () => {
    mockApi({
      'GET /api/issues/HELP-7': () => ({ json: detail(7) }),
      'GET /api/teams/HELP': () => ({ json: TEAM }),
    });
    await renderWithI18n(<IssuePage identifier="HELP-7" />);
    expect(await screen.findByDisplayValue('Issue 7')).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'Description' })).toHaveTextContent(
      'Screen flickers',
    );
    expect(screen.getByLabelText('Status')).toHaveValue('s-todo');
    expect(screen.getByText(/Ann Lee created the issue/)).toBeInTheDocument();
  });

  it('copies the identifier and the link from the header', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mockApi({
      'GET /api/issues/HELP-7': () => ({ json: detail(7) }),
      'GET /api/teams/HELP': () => ({ json: TEAM }),
    });
    await renderWithI18n(<IssuePage identifier="HELP-7" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy ID' }));
    expect(writeText).toHaveBeenLastCalledWith('HELP-7');
    expect(await screen.findByRole('status')).toHaveTextContent('ID copied');

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/issue/HELP-7`);
    expect(await screen.findByRole('status')).toHaveTextContent('Link copied');
  });

  it('falls back to the copy command when the clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    mockApi({
      'GET /api/issues/HELP-7': () => ({ json: detail(7) }),
      'GET /api/teams/HELP': () => ({ json: TEAM }),
    });
    await renderWithI18n(<IssuePage identifier="HELP-7" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Link copied');
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('stays quiet when copying is blocked entirely', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    document.execCommand = vi.fn(() => false);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mockApi({
      'GET /api/issues/HELP-7': () => ({ json: detail(7) }),
      'GET /api/teams/HELP': () => ({ json: TEAM }),
    });
    await renderWithI18n(<IssuePage identifier="HELP-7" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy ID' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('saves property changes', async () => {
    const calls = mockApi({
      'GET /api/issues/HELP-7': () => ({ json: detail(7) }),
      'GET /api/teams/HELP': () => ({ json: TEAM }),
      'PATCH /api/issues/HELP-7': (body) => ({
        json: { ...detail(7), ...(body as object), statusId: 's-done' },
      }),
    });
    await renderWithI18n(<IssuePage identifier="HELP-7" />);
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 's-done');
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'urgent');
    const title = screen.getByLabelText('Issue title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Screen replaced{Enter}');
    const patches = calls.filter((c) => c.method === 'PATCH').map((c) => c.body);
    expect(patches).toEqual([
      { statusId: 's-done' },
      { priority: 'urgent' },
      { title: 'Screen replaced' },
    ]);
  });

  it('is read-only without update permission', async () => {
    mockApi({
      'GET /api/issues/HELP-7': () => ({ json: detail(7) }),
      'GET /api/teams/HELP': () => ({
        json: {
          ...TEAM,
          can: { create: false, update: false, assign: false, comment: false, delete: false },
        },
      }),
    });
    await renderWithI18n(<IssuePage identifier="HELP-7" />);
    expect(await screen.findByLabelText('Status')).toBeDisabled();
    expect(screen.getByLabelText('Assignee')).toBeDisabled();
    expect(screen.getByLabelText('Issue title')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('shows the parent chain of a sub-issue', async () => {
    mockApi({
      'GET /api/issues/HELP-7': () => ({
        json: detail(7, {
          ancestors: [
            { id: 'i1', identifier: 'HELP-1', title: 'Office move' },
            { id: 'i2', identifier: 'HELP-2', title: 'Pack' },
          ],
        }),
      }),
      'GET /api/teams/HELP': () => ({ json: TEAM }),
    });
    await renderWithI18n(<IssuePage identifier="HELP-7" />);
    expect(await screen.findByRole('link', { name: 'HELP-1' })).toHaveAttribute(
      'href',
      '/issue/HELP-1',
    );
    expect(screen.getByRole('link', { name: 'HELP-2' })).toHaveAttribute('title', 'Pack');
  });

  it('deletes the issue after confirmation and returns to the team list', async () => {
    window.history.replaceState(null, '', '/issue/HELP-7');
    const calls = mockApi({
      'GET /api/issues/HELP-7': () => ({ json: detail(7) }),
      'GET /api/teams/HELP': () => ({ json: TEAM }),
      'DELETE /api/issues/HELP-7': () => ({ status: 204 }),
    });
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal('confirm', confirm);
    await renderWithI18n(<IssuePage identifier="HELP-7" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('Delete HELP-7?'));
    await waitFor(() => expect(window.location.pathname).toBe('/teams/HELP/issues'));
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    window.history.replaceState(null, '', '/');
  });

  it('reloads when someone else changes the issue', async () => {
    let version = 1;
    mockApi({
      'GET /api/issues/HELP-7': () => ({
        json:
          version === 1
            ? detail(7)
            : detail(7, { title: 'Renamed elsewhere', updatedAt: '2026-10-18T10:00:00.000Z' }),
      }),
      'GET /api/teams/HELP': () => ({ json: TEAM }),
    });
    await renderWithI18n(<IssuePage identifier="HELP-7" />);
    await screen.findByDisplayValue('Issue 7');
    version = 2;
    act(() =>
      realtime.push({ type: 'issue.changed', issue: issue(7, { title: 'Renamed elsewhere' }) }),
    );
    await waitFor(() => expect(screen.getByDisplayValue('Renamed elsewhere')).toBeInTheDocument());
  });
});

describe('describeEvent', () => {
  it('names statuses, people and priorities in the UI language', async () => {
    const i18n = await createI18n('ru');
    const line = describeEvent(
      i18n.t,
      {
        id: 'e',
        kind: 'updated',
        actor: { id: 'm-ann', name: 'Ann Lee' },
        changes: {
          statusId: { from: 's-todo', to: 's-done' },
          priority: { from: 'none', to: 'high' },
          assigneeId: { from: null, to: 'm-bob' },
        },
        viaToken: null,
        createdAt: '2026-10-18T09:00:00.000Z',
      },
      TEAM,
    );
    expect(line).toBe('Ann Lee: статус → Готово, приоритет → Высокий, исполнитель → Bob Stone');
  });

  it('says when an agent acted through a personal token', async () => {
    const i18n = await createI18n('en');
    const event = {
      id: 'e',
      kind: 'created' as const,
      actor: { id: 'm-ann', name: 'Ann Lee' },
      changes: {},
      viaToken: 'Claude',
      createdAt: '2026-10-18T09:00:00.000Z',
    };
    expect(describeEvent(i18n.t, event, TEAM)).toBe(
      i18n.t('issues.event.created', { actor: 'Ann Lee via token “Claude”' }),
    );
  });

  it('tells where an imported issue came from', async () => {
    const i18n = await createI18n('en');
    const event = {
      id: 'e',
      kind: 'created' as const,
      actor: { id: 'm-ann', name: 'Ann Lee' },
      changes: {
        imported: { from: null, to: { source: 'jira', key: 'OPS-12', url: 'https://x.test' } },
      },
      viaToken: null,
      createdAt: '2026-10-18T09:00:00.000Z',
    };
    expect(describeEvent(i18n.t, event, TEAM)).toBe(
      'Ann Lee imported this issue from Jira (OPS-12)',
    );
    expect(describeEvent(i18n.t, { ...event, kind: 'updated' }, TEAM)).toBe(
      'Ann Lee updated this issue from Jira (OPS-12)',
    );
  });

  it('names labels, including deleted ones, and parent changes', async () => {
    const i18n = await createI18n('en');
    const base = {
      id: 'e',
      kind: 'updated' as const,
      actor: null,
      viaToken: null,
      createdAt: '2026-10-18T09:00:00.000Z',
    };
    expect(
      describeEvent(
        i18n.t,
        { ...base, changes: { labelIds: { from: [], to: ['l-bug', 'l-gone'] } } },
        TEAM,
      ),
    ).toBe('Someone: labels → Bug, deleted label');
    expect(
      describeEvent(i18n.t, { ...base, changes: { parentId: { from: 'i1', to: null } } }, TEAM),
    ).toBe('Someone: detached from its parent');
  });
});
