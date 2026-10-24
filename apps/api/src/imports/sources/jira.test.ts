import { describe, expect, it } from 'vitest';
import { recordedFetch } from './fake-http.js';
import { JiraSource } from './jira.js';

const project = { id: '10000', key: 'OPS', name: 'Operations', statuses: [] };

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: '20001',
    key: 'OPS-12',
    fields: {
      summary: 'Printer on fire',
      description: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Help' }] }],
      },
      status: { name: 'Done', statusCategory: { key: 'done' } },
      priority: { name: 'Highest' },
      assignee: { displayName: 'Jane', emailAddress: 'jane@example.test' },
      reporter: { displayName: 'Bob' },
      creator: null,
      labels: ['hardware'],
      components: [{ name: 'Office' }],
      issuetype: { name: 'Bug' },
      duedate: null,
      created: '2026-02-01T10:00:00.000+0100',
      updated: '2026-02-02T10:00:00.000+0100',
      parent: { id: '20000' },
      resolution: { name: "Won't Do" },
      comment: {
        total: 1,
        comments: [
          { id: '1', author: null, body: 'wiki *bold*', created: '2026-02-01T11:00:00.000+0100' },
        ],
      },
      attachment: [
        {
          id: '9',
          filename: 'log.txt',
          content: 'https://acme.example.test/secure/attachment/9/log.txt',
          size: 4,
        },
      ],
      issuelinks: [{}],
      ...overrides,
    },
  };
}

describe('JiraSource', () => {
  it('uses REST v3 with Basic auth on Cloud and pages by token', async () => {
    const { fetch, calls } = recordedFetch([
      { json: { issues: [issue()], nextPageToken: 'tok2', isLast: false } },
    ]);
    const source = new JiraSource(
      'https://acme.example.test/',
      { email: 'me@example.test', token: 'secret' },
      fetch,
    );
    const page = await source.page(project, 'tok1', { includeClosed: false, jql: 'labels = x' });
    expect(calls[0]!.url).toBe('https://acme.example.test/rest/api/3/search/jql');
    expect(calls[0]!.headers.authorization).toBe(
      `Basic ${Buffer.from('me@example.test:secret').toString('base64')}`,
    );
    expect(calls[0]!.body).toMatchObject({
      jql: 'project = 10000 AND statusCategory != Done AND (labels = x) ORDER BY created ASC',
      nextPageToken: 'tok1',
    });
    expect(page.next).toBe('tok2');
    expect(page.issues[0]).toMatchObject({
      key: 'OPS-12',
      url: 'https://acme.example.test/browse/OPS-12',
      description: 'Help',
      status: { name: 'Done', category: 'canceled' },
      priority: 'urgent',
      creator: { id: 'Bob', email: null },
      labels: ['type:Bug', 'hardware', 'Office'],
      parentExternalId: '20000',
      createdAt: '2026-02-01T09:00:00.000Z',
      attachments: [{ ref: 'log.txt', size: 4 }],
      dropped: ['links'],
    });
  });

  it('uses REST v2 with a bearer token on Server and pages by offset', async () => {
    const { fetch, calls } = recordedFetch([
      {
        json: {
          total: 51,
          issues: [issue({ description: 'h2. Title', resolution: { name: 'Fixed' } })],
        },
      },
    ]);
    const source = new JiraSource('https://jira.internal.test', { token: 'pat' }, fetch);
    const page = await source.page(project, '49', { includeClosed: true });
    expect(calls[0]!.url).toBe('https://jira.internal.test/rest/api/2/search');
    expect(calls[0]!.headers.authorization).toBe('Bearer pat');
    expect(calls[0]!.body).toMatchObject({
      startAt: 49,
      jql: 'project = 10000 ORDER BY created ASC',
    });
    expect(page.next).toBe('50');
    expect(page.issues[0]!.description).toBe('## Title');
    expect(page.issues[0]!.status.category).toBe('completed');
    expect(page.issues[0]!.comments[0]!.body).toBe('wiki **bold**');
  });

  it('fetches every comment when search truncated them', async () => {
    const { fetch, calls } = recordedFetch([
      { json: { issues: [issue({ comment: { total: 30, comments: [] } })], isLast: true } },
      {
        json: {
          comments: [{ id: '5', author: null, body: 'late', created: '2026-02-03T00:00:00Z' }],
        },
      },
    ]);
    const source = new JiraSource(
      'https://acme.example.test',
      { email: 'a@example.test', token: 't' },
      fetch,
    );
    const page = await source.page(project, null, { includeClosed: true });
    expect(calls[1]!.url).toContain('/issue/20001/comment');
    expect(page.issues[0]!.comments.map((c) => c.body)).toEqual(['late']);
    expect(page.next).toBeNull();
  });

  it('merges statuses of all issue types into one list per project', async () => {
    const { fetch } = recordedFetch([
      { json: { values: [{ id: '1', key: 'OPS', name: 'Ops' }], isLast: true } },
      {
        json: [
          { statuses: [{ name: 'To Do', statusCategory: { key: 'new' } }] },
          {
            statuses: [
              { name: 'To Do', statusCategory: { key: 'new' } },
              { name: 'Doing', statusCategory: { key: 'indeterminate' } },
            ],
          },
        ],
      },
    ]);
    const source = new JiraSource(
      'https://acme.example.test',
      { email: 'a@example.test', token: 't' },
      fetch,
    );
    expect((await source.containers())[0]!.statuses).toEqual([
      { name: 'To Do', category: 'unstarted' },
      { name: 'Doing', category: 'started' },
    ]);
  });

  it('refuses to download from another host with the Jira credentials', async () => {
    const { fetch, calls } = recordedFetch([]);
    const source = new JiraSource('https://acme.example.test', { token: 't' }, fetch);
    await expect(source.download('https://evil.example.test/x')).rejects.toMatchObject({
      code: 'import_source_failed',
    });
    expect(calls).toHaveLength(0);
  });

  it('treats 401 as a credential error', async () => {
    const { fetch } = recordedFetch([{ status: 401 }]);
    const source = new JiraSource('https://acme.example.test', { token: 't' }, fetch);
    await expect(source.account()).rejects.toMatchObject({ code: 'import_auth_failed' });
  });
});
