import { describe, expect, it } from 'vitest';
import { recordedFetch } from './fake-http.js';
import { LinearSource } from './linear.js';
import { SourceError } from './types.js';

const team = { id: 't1', key: 'ENG', name: 'Engineering', statuses: [] };

describe('LinearSource', () => {
  it('sends the API key and maps teams with their workflow states', async () => {
    const { fetch, calls } = recordedFetch([
      {
        json: {
          data: {
            teams: {
              nodes: [
                {
                  id: 't1',
                  key: 'ENG',
                  name: 'Engineering',
                  states: {
                    nodes: [
                      { name: 'Triage', type: 'triage' },
                      { name: 'In Progress', type: 'started' },
                      { name: 'Done', type: 'completed' },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    ]);
    const containers = await new LinearSource('lin_api_test', fetch).containers();
    expect(calls[0]!.headers.authorization).toBe('lin_api_test');
    expect(containers[0]!.statuses).toEqual([
      { name: 'Triage', category: 'unstarted' },
      { name: 'In Progress', category: 'started' },
      { name: 'Done', category: 'completed' },
    ]);
  });

  it('converts a page of issues and returns the next cursor', async () => {
    const upload = 'https://uploads.linear.app/abc/def/screen%20shot.png';
    const { fetch, calls } = recordedFetch([
      {
        json: {
          data: {
            issues: {
              pageInfo: { hasNextPage: true, endCursor: 'c2' },
              nodes: [
                {
                  id: 'i1',
                  identifier: 'ENG-7',
                  url: 'https://linear.app/x/issue/ENG-7',
                  title: 'Crash on save',
                  description: `See ![shot](${upload})`,
                  priority: 2,
                  dueDate: '2026-11-01',
                  estimate: 3,
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-02T00:00:00.000Z',
                  state: { name: 'In Progress', type: 'started' },
                  assignee: { name: 'Jane', email: 'jane@example.test' },
                  creator: { name: 'Bob', email: null },
                  parent: { id: 'i0' },
                  cycle: null,
                  labels: { nodes: [{ name: 'bug' }] },
                  comments: {
                    nodes: [
                      {
                        id: 'c1',
                        body: 'On it',
                        createdAt: '2026-01-01T01:00:00.000Z',
                        user: null,
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    ]);
    const page = await new LinearSource('k', fetch).page(team, 'c1', { includeClosed: true });
    expect((calls[0]!.body as { variables: unknown }).variables).toEqual({
      team: 't1',
      after: 'c1',
      closed: true,
    });
    expect(page.next).toBe('c2');
    expect(page.issues[0]).toMatchObject({
      key: 'ENG-7',
      priority: 'high',
      status: { name: 'In Progress', category: 'started' },
      assignees: [{ id: 'jane@example.test', name: 'Jane' }],
      creator: { id: 'Bob', email: null },
      parentExternalId: 'i0',
      labels: ['bug'],
      attachments: [{ ref: upload, filename: 'screen shot.png', url: upload }],
      dropped: ['estimate'],
    });
  });

  it('skips closed issues when asked to', async () => {
    const node = (id: string, type: string) => ({
      id,
      identifier: id,
      url: '',
      title: id,
      description: null,
      priority: 0,
      dueDate: null,
      estimate: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      state: { name: type, type },
      assignee: null,
      creator: null,
      parent: null,
      cycle: null,
      labels: { nodes: [] },
      comments: { nodes: [] },
    });
    const { fetch } = recordedFetch([
      {
        json: {
          data: {
            issues: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [node('a', 'started'), node('b', 'completed'), node('c', 'canceled')],
            },
          },
        },
      },
    ]);
    const page = await new LinearSource('k', fetch).page(team, null, { includeClosed: false });
    expect(page.issues.map((i) => i.key)).toEqual(['a']);
    expect(page.next).toBeNull();
  });

  it('reports a rejected key as an authentication failure', async () => {
    const { fetch } = recordedFetch([
      { json: { errors: [{ message: 'Bad key', extensions: { code: 'AUTHENTICATION_ERROR' } }] } },
    ]);
    await expect(new LinearSource('k', fetch).account()).rejects.toMatchObject({
      code: 'import_auth_failed',
    });
  });

  it('asks the runner to wait when rate limited', async () => {
    const { fetch } = recordedFetch([{ status: 429, headers: { 'retry-after': '12' } }]);
    const failure = await new LinearSource('k', fetch).account().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SourceError);
    expect((failure as SourceError).retryAfterMs).toBe(12_000);
  });
});
