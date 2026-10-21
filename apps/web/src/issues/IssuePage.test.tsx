import { act, screen, waitFor } from '@testing-library/react';
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
        json: { ...TEAM, can: { create: false, update: false, assign: false, comment: false } },
      }),
    });
    await renderWithI18n(<IssuePage identifier="HELP-7" />);
    expect(await screen.findByLabelText('Status')).toBeDisabled();
    expect(screen.getByLabelText('Assignee')).toBeDisabled();
    expect(screen.getByLabelText('Issue title')).toHaveAttribute('readonly');
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
});
