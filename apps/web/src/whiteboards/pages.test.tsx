import type { WhiteboardSummary, WhiteboardView } from '@ordler/shared';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { fakeRealtime } from '../test/realtime-fake.js';
import { renderWithI18n } from '../test/render.js';
import { IssueWhiteboards } from './IssueWhiteboards.js';
import { WhiteboardPage } from './WhiteboardPage.js';
import { WhiteboardsPage } from './WhiteboardsPage.js';

const insertTemplate = vi.fn();
// The editor needs a real canvas; pages are tested with a stand-in that records its props.
vi.mock('./LazyCanvas.js', () => ({
  LazyCanvas: (props: {
    board: { title: string };
    embedded?: boolean;
    onReady?: (handle: { insertTemplate: typeof insertTemplate }) => void;
    onPeople?: (people: Array<{ id: string; name: string }>) => void;
  }) => {
    props.onReady?.({ insertTemplate });
    return (
      <div data-testid="canvas" data-embedded={String(Boolean(props.embedded))}>
        {props.board.title}
        <button type="button" onClick={() => props.onPeople?.([{ id: 'b', name: 'Bob Stand' }])}>
          someone joins
        </button>
      </div>
    );
  },
}));

const BOARD: WhiteboardView = {
  id: '0193a000-0000-7000-8000-000000000001',
  title: 'Network map',
  team: { id: 't1', key: 'HELP', name: 'Helpdesk' },
  createdBy: { id: 'm1', name: 'Ann Lee' },
  createdAt: '2026-11-10T09:00:00Z',
  updatedAt: '2026-11-10T09:00:00Z',
  canEdit: true,
  canManage: true,
  issues: [{ identifier: 'HELP-1', title: 'Office network' }],
};
const SUMMARY: WhiteboardSummary = { ...BOARD };
const TEAMS = [
  { id: 't1', key: 'HELP', name: 'Helpdesk', department: 'IT', whiteboards: true },
  { id: 't2', key: 'OPS', name: 'Ops', department: 'IT', whiteboards: false },
];

let realtime: ReturnType<typeof fakeRealtime>;
beforeEach(() => {
  realtime = fakeRealtime();
  insertTemplate.mockClear();
  window.history.pushState(null, '', '/');
});
afterEach(() => {
  realtime.reset();
  vi.unstubAllGlobals();
});

describe('WhiteboardsPage', () => {
  it('lists boards and creates one only in teams where the member may draw', async () => {
    const calls = mockApi({
      'GET /api/whiteboards': () => ({ json: [SUMMARY] }),
      'GET /api/teams': () => ({ json: TEAMS }),
      'POST /api/whiteboards': () => ({
        status: 201,
        json: { ...BOARD, id: '0193a000-0000-7000-8000-000000000002' },
      }),
    });
    await renderWithI18n(<WhiteboardsPage />);
    expect(await screen.findByText('Network map')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'HELP · Helpdesk' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'OPS · Ops' })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Whiteboard title'), 'Rack layout');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        team: 'HELP',
        title: 'Rack layout',
      }),
    );
    expect(window.location.pathname).toBe('/whiteboards/0193a000-0000-7000-8000-000000000002');
  });

  it('hides the form from members who may not create boards', async () => {
    mockApi({
      'GET /api/whiteboards': () => ({ json: [] }),
      'GET /api/teams': () => ({ json: [TEAMS[1]] }),
    });
    await renderWithI18n(<WhiteboardsPage />);
    expect(await screen.findByText(/No whiteboards yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
  });
});

describe('WhiteboardPage', () => {
  it('renames, inserts templates, shows who is here and reloads on remote changes', async () => {
    let title = 'Network map';
    const calls = mockApi({
      [`GET /api/whiteboards/${BOARD.id}`]: () => ({ json: { ...BOARD, title } }),
      [`PATCH /api/whiteboards/${BOARD.id}`]: (body) => {
        title = (body as { title: string }).title;
        return { json: { ...BOARD, title } };
      },
    });
    await renderWithI18n(<WhiteboardPage id={BOARD.id} />);
    const input = await screen.findByLabelText('Whiteboard title');
    expect(screen.getByRole('link', { name: 'HELP-1' })).toHaveAttribute('href', '/issue/HELP-1');

    await userEvent.clear(input);
    await userEvent.type(input, 'Office LAN{Enter}');
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));

    await userEvent.selectOptions(screen.getByLabelText('Insert…'), 'retrospective');
    expect(insertTemplate).toHaveBeenCalledWith('retrospective', {
      wentWell: 'Went well',
      toImprove: 'To improve',
      actions: 'Action items',
    });

    await userEvent.click(screen.getByRole('button', { name: 'someone joins' }));
    expect(screen.getByLabelText('1 person here')).toBeInTheDocument();

    title = 'Renamed elsewhere';
    act(() => realtime.push({ type: 'whiteboard.changed', whiteboardId: BOARD.id }));
    expect(await screen.findByDisplayValue('Renamed elsewhere')).toBeInTheDocument();
  });

  it('is view only without whiteboard.edit, and says when the board is gone', async () => {
    mockApi({
      [`GET /api/whiteboards/${BOARD.id}`]: () => ({
        json: { ...BOARD, canEdit: false, canManage: false },
      }),
    });
    await renderWithI18n(<WhiteboardPage id={BOARD.id} />);
    expect(await screen.findByText('View only')).toBeInTheDocument();
    expect(screen.queryByLabelText('Insert…')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete whiteboard')).not.toBeInTheDocument();
  });

  it('explains a deleted board', async () => {
    mockApi({
      [`GET /api/whiteboards/${BOARD.id}`]: () => ({ status: 404, json: { error: 'not_found' } }),
    });
    await renderWithI18n(<WhiteboardPage id={BOARD.id} />);
    expect(await screen.findByText(/was deleted/)).toBeInTheDocument();
  });
});

describe('IssueWhiteboards', () => {
  const issue = { identifier: 'HELP-1', title: 'Office network' };
  const team = {
    key: 'HELP',
    can: {
      create: true,
      update: true,
      assign: true,
      comment: true,
      delete: true,
      shareViews: false,
      whiteboards: true,
    },
  };

  it('shows attached boards live inside the issue and attaches, creates and detaches', async () => {
    let attached: WhiteboardSummary[] = [SUMMARY];
    const other = { ...SUMMARY, id: '0193a000-0000-7000-8000-000000000003', title: 'Floor plan' };
    const calls = mockApi({
      'GET /api/issues/HELP-1/whiteboards': () => ({ json: attached }),
      'GET /api/whiteboards': () => ({ json: [SUMMARY, other] }),
      'POST /api/issues/HELP-1/whiteboards': () => {
        attached = [SUMMARY, other];
        return { status: 201, json: attached };
      },
      [`DELETE /api/issues/HELP-1/whiteboards/${BOARD.id}`]: () => {
        attached = [other];
        return { status: 204 };
      },
      'POST /api/whiteboards': () => ({
        status: 201,
        json: { ...BOARD, id: '0193a000-0000-7000-8000-000000000004' },
      }),
    });
    await renderWithI18n(<IssueWhiteboards issue={issue} team={team} onError={vi.fn()} />);
    const preview = await screen.findByTestId('canvas');
    expect(preview).toHaveAttribute('data-embedded', 'true');
    expect(preview).toHaveTextContent('Network map');
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      `/whiteboards/${BOARD.id}`,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Attach existing' }));
    const select = await screen.findByLabelText('Attach existing');
    // Boards already on the issue are not offered again.
    expect(screen.queryByRole('option', { name: 'HELP · Network map' })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, other.id);
    expect(await screen.findAllByTestId('canvas')).toHaveLength(2);

    await userEvent.click(screen.getByLabelText('Detach “Network map”'));
    await waitFor(() => expect(screen.getAllByTestId('canvas')).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: /New whiteboard/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/api/whiteboards')?.body).toEqual(
        {
          team: 'HELP',
          title: 'Office network',
          issue: 'HELP-1',
        },
      ),
    );
  });

  it('only shows boards to members who may not change the issue', async () => {
    mockApi({ 'GET /api/issues/HELP-1/whiteboards': () => ({ json: [SUMMARY] }) });
    await renderWithI18n(
      <IssueWhiteboards
        issue={issue}
        team={{ ...team, can: { ...team.can, update: false, whiteboards: false } }}
        onError={vi.fn()}
      />,
    );
    expect(await screen.findByTestId('canvas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attach existing' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Detach “Network map”')).not.toBeInTheDocument();
  });
});
