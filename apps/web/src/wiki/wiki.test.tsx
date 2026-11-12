import type {
  WhiteboardView,
  WikiImportSourcePage,
  WikiImportView,
  WikiPageView,
  WikiSpace,
  WikiTree,
} from '@ordler/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { WikiHome } from './WikiHome.js';
import { WikiImport } from './WikiImport.js';
import { WikiPageScreen } from './WikiPageScreen.js';
import { WikiSpacePage } from './WikiSpacePage.js';

// The whiteboard editor needs a real canvas; embeds are checked through a stand-in.
vi.mock('../whiteboards/LazyCanvas.js', () => ({
  LazyCanvas: (props: { board: { title: string }; embedded?: boolean }) => (
    <div data-testid="canvas" data-embedded={String(Boolean(props.embedded))}>
      {props.board.title}
    </div>
  ),
}));

const DEPT = '0193a000-0000-7000-8000-0000000000d1';
const PAGE_ID = '0193a000-0000-7000-8000-0000000000a1';
const BOARD_ID = '0193a000-0000-7000-8000-0000000000b1';

const SPACE: WikiSpace = {
  department: { id: DEPT, name: 'IT' },
  visibility: 'department',
  pages: 1,
  canEdit: true,
  canManage: true,
};
const TREE: WikiTree = {
  space: SPACE,
  folders: [{ id: 'f1', parentId: null, name: 'Runbooks' }],
  pages: [
    {
      id: PAGE_ID,
      departmentId: DEPT,
      folderId: 'f1',
      title: 'Incidents',
      version: 3,
      updatedAt: '2026-11-12T09:00:00Z',
      updatedBy: { id: 'm1', name: 'Ann Lee' },
    },
  ],
};
const PAGE: WikiPageView = {
  ...TREE.pages[0]!,
  department: { id: DEPT, name: 'IT' },
  path: [{ id: 'f1', parentId: null, name: 'Runbooks' }],
  content: `How we handle incidents.\n\n[Incident flow](/whiteboards/${BOARD_ID})\n\nCall the on-call engineer.`,
  createdAt: '2026-11-10T09:00:00Z',
  createdBy: { id: 'm1', name: 'Ann Lee' },
  canEdit: true,
  canManage: true,
};
const BOARD: WhiteboardView = {
  id: BOARD_ID,
  title: 'Incident flow',
  team: { id: 't1', key: 'HELP', name: 'Helpdesk' },
  createdBy: null,
  createdAt: '2026-11-10T09:00:00Z',
  updatedAt: '2026-11-10T09:00:00Z',
  canEdit: true,
  canManage: true,
  issues: [],
};

beforeEach(() => window.history.pushState(null, '', '/'));
afterEach(() => vi.unstubAllGlobals());

describe('WikiHome', () => {
  it('lists readable spaces and searches across them', async () => {
    const calls = mockApi({
      'GET /api/wiki/spaces': () => ({
        json: [
          SPACE,
          { ...SPACE, department: { id: 'd2', name: 'HR' }, visibility: 'organization', pages: 4 },
        ],
      }),
      'GET /api/wiki/search?q=vpn': () => ({
        json: [
          {
            id: PAGE_ID,
            title: 'VPN',
            department: { id: DEPT, name: 'IT' },
            snippet: 'Use WireGuard',
            updatedAt: '2026-11-12T09:00:00Z',
          },
        ],
      }),
    });
    await renderWithI18n(<WikiHome />);
    expect(await screen.findByRole('link', { name: /HR/ })).toHaveAttribute('href', '/wiki/d2');
    expect(screen.getByText('4 pages')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search the wiki'), 'vpn');
    expect(await screen.findByText('Use WireGuard')).toBeInTheDocument();
    expect(calls.filter((c) => c.path.startsWith('/api/wiki/search'))).toHaveLength(1);
  });
});

describe('WikiSpacePage', () => {
  it('browses folders and creates a page that opens in the editor', async () => {
    const calls = mockApi({
      [`GET /api/wiki/spaces/${DEPT}`]: () => ({ json: TREE }),
      'POST /api/wiki/pages': () => ({ status: 201, json: { ...PAGE, id: 'new-page' } }),
    });
    await renderWithI18n(<WikiSpacePage departmentId={DEPT} />);
    // The folder is in the tree and in the list; the list entry opens it.
    await userEvent.click((await screen.findAllByRole('button', { name: 'Runbooks' })).at(-1)!);
    expect(await screen.findAllByRole('link', { name: /Incidents/ })).not.toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'New page' }));
    await userEvent.type(screen.getByLabelText('Page title'), 'Backups{Enter}');
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        department: DEPT,
        folderId: 'f1',
        title: 'Backups',
      }),
    );
    expect(window.location.pathname).toBe('/wiki/page/new-page/edit');
  });

  it('hides editing and management from readers', async () => {
    mockApi({
      [`GET /api/wiki/spaces/${DEPT}`]: () => ({
        json: { ...TREE, space: { ...SPACE, canEdit: false, canManage: false } },
      }),
    });
    await renderWithI18n(<WikiSpacePage departmentId={DEPT} />);
    expect(await screen.findAllByRole('button', { name: 'Runbooks' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'New page' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Who can read this space')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import from Wiki.js' })).not.toBeInTheDocument();
  });
});

describe('WikiPageScreen', () => {
  it('shows the text with the diagram whiteboard live in its place', async () => {
    mockApi({
      [`GET /api/wiki/pages/${PAGE_ID}`]: () => ({ json: PAGE }),
      [`GET /api/wiki/spaces/${DEPT}`]: () => ({ json: TREE }),
      [`GET /api/whiteboards/${BOARD_ID}`]: () => ({ json: BOARD }),
    });
    await renderWithI18n(<WikiPageScreen id={PAGE_ID} />);
    expect(await screen.findByRole('heading', { name: 'Incidents', level: 1 })).toBeInTheDocument();
    expect(await screen.findByTestId('canvas')).toHaveAttribute('data-embedded', 'true');
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      `/whiteboards/${BOARD_ID}`,
    );
    expect(screen.getByText('Call the on-call engineer.')).toBeInTheDocument();
  });

  it('tells readers when an embedded board is not visible to them', async () => {
    mockApi({
      [`GET /api/wiki/pages/${PAGE_ID}`]: () => ({
        json: { ...PAGE, canEdit: false, canManage: false },
      }),
      [`GET /api/wiki/spaces/${DEPT}`]: () => ({ json: TREE }),
      [`GET /api/whiteboards/${BOARD_ID}`]: () => ({ status: 404, json: { error: 'not_found' } }),
    });
    await renderWithI18n(<WikiPageScreen id={PAGE_ID} />);
    expect(await screen.findByText(/belongs to a team you cannot see/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('saves edits against the version they started from and explains a conflict', async () => {
    const calls = mockApi({
      [`GET /api/wiki/pages/${PAGE_ID}`]: () => ({ json: PAGE }),
      [`GET /api/wiki/spaces/${DEPT}`]: () => ({ json: TREE }),
      [`GET /api/whiteboards/${BOARD_ID}`]: () => ({ json: BOARD }),
      [`PATCH /api/wiki/pages/${PAGE_ID}`]: () => ({
        status: 409,
        json: { error: 'wiki_conflict' },
      }),
    });
    await renderWithI18n(<WikiPageScreen id={PAGE_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const title = screen.getByLabelText('Page title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Major incidents');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/saved a newer version/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      title: 'Major incidents',
      baseVersion: 3,
    });
  });

  it('inserts a new whiteboard as a diagram embed while editing', async () => {
    const calls = mockApi({
      [`GET /api/wiki/pages/${PAGE_ID}`]: () => ({ json: { ...PAGE, content: 'Intro' } }),
      [`GET /api/wiki/spaces/${DEPT}`]: () => ({ json: TREE }),
      'GET /api/whiteboards': () => ({ json: [] }),
      'GET /api/teams': () => ({
        json: [{ id: 't1', key: 'HELP', name: 'Helpdesk', department: 'IT', whiteboards: true }],
      }),
      'POST /api/whiteboards': () => ({ status: 201, json: { ...BOARD, title: 'Escalation' } }),
      [`PATCH /api/wiki/pages/${PAGE_ID}`]: (body) => ({ json: { ...PAGE, ...(body as object) } }),
    });
    await renderWithI18n(<WikiPageScreen id={PAGE_ID} edit />);
    await userEvent.click(await screen.findByRole('button', { name: 'Insert diagram' }));
    await userEvent.type(await screen.findByLabelText('New whiteboard title'), 'Escalation');
    await userEvent.click(screen.getByRole('button', { name: 'Create and insert' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH');
      expect((patch?.body as { content: string }).content).toContain(
        `[Escalation](/whiteboards/${BOARD_ID})`,
      );
    });
  });

  it('shows the history and restores an older version', async () => {
    const calls = mockApi({
      [`GET /api/wiki/pages/${PAGE_ID}`]: () => ({ json: { ...PAGE, content: 'Now' } }),
      [`GET /api/wiki/spaces/${DEPT}`]: () => ({ json: TREE }),
      [`GET /api/wiki/pages/${PAGE_ID}/revisions`]: () => ({
        json: [
          {
            version: 3,
            title: 'Incidents',
            author: { id: 'm1', name: 'Ann Lee' },
            createdAt: '2026-11-12T09:00:00Z',
          },
          { version: 1, title: 'Incidents', author: null, createdAt: '2026-11-10T09:00:00Z' },
        ],
      }),
      [`GET /api/wiki/pages/${PAGE_ID}/revisions/1`]: () => ({
        json: {
          version: 1,
          title: 'Incidents',
          content: 'Before',
          author: null,
          createdAt: '2026-11-10T09:00:00Z',
        },
      }),
      [`PATCH /api/wiki/pages/${PAGE_ID}`]: () => ({ json: PAGE }),
    });
    await renderWithI18n(<WikiPageScreen id={PAGE_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'History' }));
    await userEvent.click(await screen.findByRole('button', { name: /Version 1/ }));
    expect(await screen.findByText('Before')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        title: 'Incidents',
        content: 'Before',
        baseVersion: 3,
      }),
    );
  });
});

describe('WikiImport', () => {
  it('connects to Wiki.js, imports ticked folders and pages and shows the result', async () => {
    const run: WikiImportView = {
      id: 'run-1',
      department: { id: DEPT, name: 'IT' },
      folderId: 'f1',
      baseUrl: 'https://wiki.test',
      status: 'draft',
      total: 0,
      counts: { imported: 0, updated: 0, skipped: 0, failed: 0, files: 0 },
      report: [],
      error: null,
      createdAt: '2026-11-12T09:00:00Z',
      finishedAt: null,
    };
    const pages: WikiImportSourcePage[] = [
      { id: 1, path: 'home', locale: 'en', title: 'Home', updatedAt: '2025-01-01T00:00:00Z' },
      {
        id: 2,
        path: 'docs/setup',
        locale: 'en',
        title: 'Setup',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ];
    const calls = mockApi({
      'POST /api/wiki/imports': () => ({ status: 201, json: run }),
      'GET /api/wiki/imports/run-1/pages': () => ({ json: pages }),
      'POST /api/wiki/imports/run-1/start': () => ({
        status: 201,
        json: {
          ...run,
          status: 'completed',
          total: 2,
          counts: { ...run.counts, imported: 2, files: 1 },
        },
      }),
    });
    const onClose = vi.fn();
    await renderWithI18n(<WikiImport departmentId={DEPT} folderId="f1" onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('Wiki.js address'), 'https://wiki.test');
    await userEvent.type(screen.getByLabelText('Wiki.js API key'), 'k'.repeat(40));
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'docs/' }));
    // Pages inside a ticked folder come with it.
    expect(screen.getByRole('checkbox', { name: /Setup/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Home/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Start import' }));
    expect(await screen.findByText(/2 imported/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/wiki/imports')?.body).toEqual({
      department: DEPT,
      folderId: 'f1',
      baseUrl: 'https://wiki.test',
      token: 'k'.repeat(40),
    });
    expect(calls.find((c) => c.path.endsWith('/start'))?.body).toEqual({
      paths: ['docs'],
      pageIds: [1],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
