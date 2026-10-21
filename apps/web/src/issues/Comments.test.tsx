import type { CommentView } from '@ordler/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { fakeRealtime } from '../test/realtime-fake.js';
import { renderWithI18n } from '../test/render.js';
import { detail, TEAM } from './fixtures.js';
import { IssuePage, timeline } from './IssuePage.js';

let realtime: ReturnType<typeof fakeRealtime>;
beforeEach(() => {
  realtime = fakeRealtime();
});
afterEach(() => {
  realtime.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const comment = (overrides: Partial<CommentView> = {}): CommentView => ({
  id: 'c1',
  author: { id: 'm-bob', name: 'Bob Stone' },
  body: 'Checked the **cable**',
  createdAt: '2026-10-18T09:30:00.000Z',
  updatedAt: '2026-10-18T09:30:00.000Z',
  edited: false,
  deleted: false,
  canEdit: true,
  canDelete: true,
  ...overrides,
});

/** Puts text into a rich editor the way a browser paste does. */
function paste(editor: HTMLElement, text: string) {
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      files: [],
      types: ['text/plain'],
    },
  });
}

describe('issue comments', () => {
  it('shows comments between history entries, in time order', () => {
    const entries = timeline(
      detail(7, {
        comments: [comment()],
        events: [
          {
            id: 'e1',
            kind: 'created',
            actor: null,
            changes: {},
            viaToken: null,
            createdAt: '2026-10-18T09:00:00.000Z',
          },
          {
            id: 'e2',
            kind: 'updated',
            actor: null,
            changes: { priority: { from: 'none', to: 'high' } },
            viaToken: null,
            createdAt: '2026-10-18T10:00:00.000Z',
          },
        ],
      }),
    );
    expect(entries.map((e) => (e.kind === 'event' ? e.event.id : e.comment.id))).toEqual([
      'e1',
      'c1',
      'e2',
    ]);
  });

  it('renders comments as rich text with their author', async () => {
    mockApi({
      'GET /api/issues/HELP-7': () => ({
        json: detail(7, { comments: [comment({ edited: true })] }),
      }),
      'GET /api/teams/HELP': () => ({ json: TEAM }),
    });
    await renderWithI18n(<IssuePage identifier="HELP-7" />);
    const item = await screen.findByRole('article', { name: 'Comment by Bob Stone' });
    expect(within(item).getByText('cable').tagName).toBe('STRONG');
    expect(within(item).getByText('· edited')).toBeInTheDocument();
  });

  it('sends a new comment and shows the server answer', async () => {
    const calls = mockApi({
      'GET /api/issues/HELP-7': () => ({ json: detail(7) }),
      'GET /api/teams/HELP': () => ({ json: TEAM }),
      'POST /api/issues/HELP-7/comments': () => ({
        status: 201,
        json: detail(7, {
          comments: [comment({ author: { id: 'm-ann', name: 'Ann Lee' }, body: 'On my way' })],
        }),
      }),
    });
    await renderWithI18n(<IssuePage identifier="HELP-7" />);
    const send = await screen.findByRole('button', { name: 'Comment' });
    expect(send).toBeDisabled();
    paste(screen.getByRole('textbox', { name: 'New comment' }), 'On my way');
    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);
    expect(await screen.findByRole('article', { name: 'Comment by Ann Lee' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ body: 'On my way' });
  });

  it('deletes after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = mockApi({
      'GET /api/issues/HELP-7': () => ({ json: detail(7, { comments: [comment()] }) }),
      'GET /api/teams/HELP': () => ({ json: TEAM }),
      'DELETE /api/comments/c1': () => ({
        json: detail(7, {
          comments: [comment({ deleted: true, body: null, canEdit: false, canDelete: false })],
        }),
      }),
    });
    await renderWithI18n(<IssuePage identifier="HELP-7" />);
    const item = await screen.findByRole('article', { name: 'Comment by Bob Stone' });
    await userEvent.click(within(item).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Comment deleted')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('hides actions the viewer may not take', async () => {
    mockApi({
      'GET /api/issues/HELP-7': () => ({
        json: detail(7, { comments: [comment({ canEdit: false, canDelete: false })] }),
      }),
      'GET /api/teams/HELP': () => ({ json: { ...TEAM, can: { ...TEAM.can, comment: false } } }),
    });
    await renderWithI18n(<IssuePage identifier="HELP-7" />);
    const item = await screen.findByRole('article', { name: 'Comment by Bob Stone' });
    expect(within(item).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(item).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'New comment' })).not.toBeInTheDocument();
  });
});
