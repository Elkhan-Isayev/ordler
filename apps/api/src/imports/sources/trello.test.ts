import { describe, expect, it } from 'vitest';
import { recordedFetch } from './fake-http.js';
import { ARCHIVED, boardKey, createdAtOf, listCategory, TrelloSource } from './trello.js';
import { SourceError } from './types.js';

const CREDENTIALS = { apiKey: 'k'.repeat(32), token: 't'.repeat(64) };
const AUTH = `OAuth oauth_consumer_key="${'k'.repeat(32)}", oauth_token="${'t'.repeat(64)}"`;
const BOARD = { id: 'b1', key: 'RM', name: 'Roadmap', statuses: [] };
// ObjectIds: the first 8 hex digits are seconds since the epoch.
const CARD_1 = '69000000aaaaaaaaaaaaaaa1';
const CARD_2 = '69000001aaaaaaaaaaaaaaa2';
const CARD_3 = '69000002aaaaaaaaaaaaaaa3';

function card(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    idShort: Number(id.slice(-1)),
    name: `Card ${id.slice(-1)}`,
    desc: '',
    closed: false,
    idList: 'l-todo',
    url: `https://trello.com/c/${id}`,
    due: null,
    start: null,
    dateLastActivity: '2026-01-05T00:00:00.000Z',
    badges: { comments: 0 },
    labels: [],
    members: [],
    attachments: [],
    checklists: [],
    ...overrides,
  };
}

const LISTS = [
  { id: 'l-todo', name: 'To Do', closed: false },
  { id: 'l-done', name: 'Done', closed: false },
  { id: 'l-old', name: 'Old', closed: true },
];

describe('TrelloSource', () => {
  it('sends the key and token in the OAuth header, never in the URL', async () => {
    const { fetch, calls } = recordedFetch([
      { json: { fullName: 'Trello Admin', username: 'admin', email: null } },
    ]);
    const account = await new TrelloSource(CREDENTIALS, fetch).account();
    expect(account).toEqual({ name: 'Trello Admin', email: null });
    expect(calls[0]!.headers.authorization).toBe(AUTH);
    expect(calls[0]!.url).not.toContain('t'.repeat(64));
    expect(calls[0]!.url).not.toContain('k'.repeat(32));
  });

  it('turns open boards into containers and their open lists into statuses', async () => {
    const { fetch, calls } = recordedFetch([
      {
        json: [
          {
            id: 'b1',
            name: 'Product roadmap',
            lists: [
              { name: 'Backlog', closed: false },
              { name: 'In Progress', closed: false },
              { name: 'Done', closed: false },
              { name: 'Old', closed: true },
            ],
          },
        ],
      },
    ]);
    const [board] = await new TrelloSource(CREDENTIALS, fetch).containers();
    expect(calls[0]!.url).toContain('/members/me/boards?filter=open');
    expect(board).toEqual({
      id: 'b1',
      key: 'PR',
      name: 'Product roadmap',
      statuses: [
        { name: 'Backlog', category: 'backlog' },
        { name: 'In Progress', category: 'started' },
        { name: 'Done', category: 'completed' },
        { name: ARCHIVED, category: 'canceled' },
      ],
    });
  });

  it('lists board members once each, keyed by username because Trello hides emails', async () => {
    const { fetch } = recordedFetch([
      { json: [{ fullName: 'Jane Doe', username: 'jane' }] },
      {
        json: [
          { fullName: 'Jane Doe', username: 'jane' },
          { fullName: '', username: 'bob' },
        ],
      },
    ]);
    const people = await new TrelloSource(CREDENTIALS, fetch).people(['b1', 'b2']);
    expect(people).toEqual([
      { id: '@jane', name: 'Jane Doe', email: null },
      { id: '@bob', name: 'bob', email: null },
    ]);
  });

  it('converts cards with checklists, links, uploads, members, labels and comments', async () => {
    const upload = `https://trello.com/1/cards/${CARD_1}/attachments/a1/download/shot.png`;
    const { fetch, calls } = recordedFetch([
      { json: LISTS },
      {
        json: [
          card(CARD_1, {
            desc: 'Make it **fast**',
            due: '2026-12-01T12:00:00.000Z',
            start: '2026-11-01T00:00:00.000Z',
            badges: { comments: 2 },
            labels: [
              { name: 'bug', color: 'red' },
              { name: '', color: 'green' },
            ],
            members: [{ fullName: 'Jane Doe', username: 'jane' }],
            attachments: [
              { id: 'a1', name: 'shot.png', url: upload, bytes: 120, isUpload: true },
              {
                id: 'a2',
                name: 'Spec',
                url: 'https://docs.example.test/spec',
                bytes: null,
                isUpload: false,
              },
              // An "upload" served from elsewhere stays a plain link and never gets the credentials.
              {
                id: 'a3',
                name: 'evil.png',
                url: 'https://evil.example.test/x.png',
                bytes: 1,
                isUpload: true,
              },
            ],
            checklists: [
              {
                name: 'Steps',
                pos: 1,
                checkItems: [
                  { name: 'Second', state: 'incomplete', pos: 2 },
                  { name: 'First', state: 'complete', pos: 1 },
                ],
              },
            ],
          }),
        ],
      },
      {
        json: [
          {
            id: 'c2',
            date: '2026-01-03T00:00:00.000Z',
            data: { text: 'Newer' },
            memberCreator: { fullName: 'Bob', username: 'bob' },
          },
          {
            id: 'c1',
            date: '2026-01-02T00:00:00.000Z',
            data: { text: 'Older' },
            memberCreator: null,
          },
        ],
      },
    ]);
    const page = await new TrelloSource(CREDENTIALS, fetch).page(BOARD, null, {
      includeClosed: true,
    });
    expect(calls[1]!.url).toContain('/boards/b1/cards/all?');
    expect(calls[2]!.url).toContain(`/cards/${CARD_1}/actions?filter=commentCard`);
    expect(page.next).toBeNull();
    const [issue] = page.issues;
    expect(issue).toMatchObject({
      externalId: CARD_1,
      key: 'RM-1',
      title: 'Card 1',
      status: { name: 'To Do', category: 'unstarted' },
      priority: 'none',
      assignees: [{ id: '@jane', name: 'Jane Doe', email: null }],
      labels: ['bug', 'green'],
      dueDate: '2026-12-01',
      createdAt: createdAtOf(CARD_1),
      updatedAt: '2026-01-05T00:00:00.000Z',
      dropped: ['startDate'],
      attachments: [{ ref: upload, filename: 'shot.png', url: upload, size: 120 }],
    });
    expect(issue!.description).toBe(
      'Make it **fast**\n\n### Steps\n- [x] First\n- [ ] Second\n\n' +
        '- [Spec](https://docs.example.test/spec)\n- [evil.png](https://evil.example.test/x.png)',
    );
    expect(issue!.comments.map((c) => [c.body, c.author?.id ?? null])).toEqual([
      ['Older', null],
      ['Newer', '@bob'],
    ]);
  });

  it('pages through cards in creation order and resumes after the cursor', async () => {
    const many = Array.from({ length: 52 }, (_, i) =>
      card(`${(0x69000000 + i).toString(16)}aaaaaaaaaaaaaaaa`, { idShort: i + 1 }),
    ).reverse();
    const { fetch } = recordedFetch([
      { json: LISTS },
      { json: many },
      { json: LISTS },
      { json: many },
    ]);
    const source = new TrelloSource(CREDENTIALS, fetch);
    const first = await source.page(BOARD, null, { includeClosed: true });
    expect(first.issues).toHaveLength(50);
    expect(first.issues[0]!.key).toBe('RM-1');
    expect(first.next).toBe(first.issues[49]!.externalId);
    const second = await source.page(BOARD, first.next, { includeClosed: true });
    expect(second.issues.map((i) => i.key)).toEqual(['RM-51', 'RM-52']);
    expect(second.next).toBeNull();
  });

  it('marks archived cards and cards in archived lists, and skips them when asked', async () => {
    const cards = [
      card(CARD_1, { closed: true }),
      card(CARD_2, { idList: 'l-old' }),
      card(CARD_3, { idList: 'l-done' }),
    ];
    const { fetch, calls } = recordedFetch([
      { json: LISTS },
      { json: cards },
      { json: LISTS },
      { json: cards },
    ]);
    const source = new TrelloSource(CREDENTIALS, fetch);
    const all = await source.page(BOARD, null, { includeClosed: true });
    expect(all.issues.map((i) => i.status)).toEqual([
      { name: ARCHIVED, category: 'canceled' },
      { name: ARCHIVED, category: 'canceled' },
      { name: 'Done', category: 'completed' },
    ]);
    const open = await source.page(BOARD, null, { includeClosed: false });
    expect(calls[3]!.url).toContain('/boards/b1/cards/open?');
    expect(open.issues.map((i) => i.externalId)).toEqual([CARD_3]);
  });

  it('downloads uploads with the credentials, only from Trello', async () => {
    const { fetch, calls } = recordedFetch([
      { body: 'png-bytes', headers: { 'content-type': 'image/png' } },
    ]);
    const source = new TrelloSource(CREDENTIALS, fetch);
    const file = await source.download('https://trello.com/1/cards/x/attachments/y/download/a.png');
    expect(file.contentType).toBe('image/png');
    expect(file.data.toString()).toBe('png-bytes');
    expect(calls[0]!.headers.authorization).toBe(AUTH);
    await expect(source.download('https://evil.example.test/a.png')).rejects.toBeInstanceOf(
      SourceError,
    );
    expect(calls).toHaveLength(1);
  });

  it('reports a refused token as an authentication error', async () => {
    const { fetch } = recordedFetch([{ status: 401, json: {} }]);
    await expect(new TrelloSource(CREDENTIALS, fetch).account()).rejects.toMatchObject({
      code: 'import_auth_failed',
    });
  });
});

describe('Trello helpers', () => {
  it('guesses the kind of a list from its name in every supported language', () => {
    expect(listCategory('Done ✅')).toBe('completed');
    expect(listCategory('Готово')).toBe('completed');
    expect(listCategory('В работе')).toBe('started');
    expect(listCategory('Erledigt')).toBe('completed');
    expect(listCategory('Backlog')).toBe('backlog');
    expect(listCategory('Rejected')).toBe('canceled');
    expect(listCategory('To Do')).toBe('unstarted');
  });

  it('suggests a valid team key from a board name', () => {
    expect(boardKey('Product roadmap')).toBe('PR');
    expect(boardKey('Marketing')).toBe('MARKET');
    expect(boardKey('Доска команды')).toBe('TRELLO');
    expect(boardKey('2026 Plans')).toBe('PLANS');
  });

  it('reads the creation time from a card id', () => {
    expect(createdAtOf('000000000000000000000000')).toBe('1970-01-01T00:00:00.000Z');
    expect(createdAtOf('69000000aaaaaaaaaaaaaaa1')).toBe(new Date(0x69000000 * 1000).toISOString());
  });
});
