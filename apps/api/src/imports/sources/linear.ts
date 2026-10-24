import type { ImportContainer, IssueStatusCategory, Priority } from '@ordler/shared';
import {
  SourceError,
  sourceJson,
  type ExternalIssue,
  type ExternalPerson,
  type HttpFetch,
  type ImportSourceAdapter,
} from './types.js';

const API = 'https://api.linear.app/graphql';
const PRIORITIES: Priority[] = ['none', 'urgent', 'high', 'medium', 'low'];
const CATEGORY: Record<string, IssueStatusCategory> = {
  backlog: 'backlog',
  unstarted: 'unstarted',
  triage: 'unstarted',
  started: 'started',
  completed: 'completed',
  canceled: 'canceled',
};
/** Files uploaded to Linear live here and need the API key to download. */
const UPLOAD_URL = /https:\/\/uploads\.linear\.app\/[^\s)"']+/g;

interface LinearUser {
  name: string;
  email: string | null;
}

function person(user: LinearUser | null | undefined): ExternalPerson | null {
  if (!user) return null;
  return { id: user.email ?? user.name, name: user.name, email: user.email ?? null };
}

const ISSUES = `query Issues($team: ID!, $after: String, $closed: Boolean!) {
  issues(first: 50, after: $after, includeArchived: $closed,
    filter: { team: { id: { eq: $team } } }, orderBy: createdAt) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id identifier url title description priority dueDate estimate createdAt updatedAt
      state { name type }
      assignee { name email }
      creator { name email }
      parent { id }
      cycle { id }
      labels { nodes { name } }
      comments(first: 100) { nodes { id body createdAt user { name email } } }
    }
  }
}`;

/** Linear's GraphQL API with a personal API key (ADR 0010). */
export class LinearSource implements ImportSourceAdapter {
  constructor(
    private readonly token: string,
    private readonly fetch: HttpFetch,
  ) {}

  private async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const result = (await sourceJson(this.fetch, API, {
      method: 'POST',
      headers: { authorization: this.token },
      body: { query, variables },
    })) as { data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }> };
    if (result.errors?.length) {
      const auth = result.errors.some((e) => e.extensions?.code === 'AUTHENTICATION_ERROR');
      throw new SourceError(
        auth ? 'import_auth_failed' : 'import_source_failed',
        result.errors[0]!.message,
      );
    }
    return result.data as T;
  }

  async account() {
    const data = await this.query<{ viewer: LinearUser }>('query { viewer { name email } }');
    return { name: data.viewer.name, email: data.viewer.email };
  }

  async containers(): Promise<ImportContainer[]> {
    const data = await this.query<{
      teams: {
        nodes: Array<{
          id: string;
          key: string;
          name: string;
          states: { nodes: Array<{ name: string; type: string }> };
        }>;
      };
    }>('query { teams(first: 100) { nodes { id key name states { nodes { name type } } } } }');
    return data.teams.nodes.map((team) => ({
      id: team.id,
      key: team.key,
      name: team.name,
      statuses: team.states.nodes.map((s) => ({
        name: s.name,
        category: CATEGORY[s.type] ?? 'unstarted',
      })),
    }));
  }

  async people(): Promise<ExternalPerson[]> {
    const result: ExternalPerson[] = [];
    let after: string | null = null;
    do {
      const data: {
        users: {
          nodes: LinearUser[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } = await this.query(
        'query Users($after: String) { users(first: 100, after: $after) { nodes { name email } pageInfo { hasNextPage endCursor } } }',
        { after },
      );
      result.push(...data.users.nodes.map((u) => person(u)!));
      after = data.users.pageInfo.hasNextPage ? data.users.pageInfo.endCursor : null;
    } while (after);
    return result;
  }

  async page(
    container: ImportContainer,
    cursor: string | null,
    options: { includeClosed: boolean },
  ) {
    type Node = {
      id: string;
      identifier: string;
      url: string;
      title: string;
      description: string | null;
      priority: number;
      dueDate: string | null;
      estimate: number | null;
      createdAt: string;
      updatedAt: string;
      state: { name: string; type: string };
      assignee: LinearUser | null;
      creator: LinearUser | null;
      parent: { id: string } | null;
      cycle: { id: string } | null;
      labels: { nodes: Array<{ name: string }> };
      comments: {
        nodes: Array<{ id: string; body: string; createdAt: string; user: LinearUser | null }>;
      };
    };
    const data = await this.query<{
      issues: { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    }>(ISSUES, { team: container.id, after: cursor, closed: options.includeClosed });
    const issues = data.issues.nodes
      .filter((n) => options.includeClosed || !['completed', 'canceled'].includes(n.state.type))
      .map((n): ExternalIssue => {
        const texts = [n.description ?? '', ...n.comments.nodes.map((c) => c.body)].join('\n');
        const uploads = [...new Set(texts.match(UPLOAD_URL) ?? [])];
        return {
          externalId: n.id,
          key: n.identifier,
          url: n.url,
          title: n.title,
          description: n.description ?? '',
          status: { name: n.state.name, category: CATEGORY[n.state.type] ?? 'unstarted' },
          priority: PRIORITIES[n.priority] ?? 'none',
          assignees: n.assignee ? [person(n.assignee)!] : [],
          creator: person(n.creator),
          labels: n.labels.nodes.map((l) => l.name),
          dueDate: n.dueDate,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
          parentExternalId: n.parent?.id ?? null,
          comments: n.comments.nodes.map((c) => ({
            externalId: c.id,
            author: person(c.user),
            body: c.body,
            createdAt: c.createdAt,
          })),
          attachments: uploads.map((url) => ({
            ref: url,
            filename: decodeURIComponent(url.split('/').pop()!.split('?')[0]!) || 'file',
            url,
            size: null,
          })),
          dropped: [...(n.estimate !== null ? ['estimate'] : []), ...(n.cycle ? ['cycle'] : [])],
        };
      });
    return {
      issues,
      next: data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null,
    };
  }

  async download(url: string) {
    const response = await this.fetch(url, {
      method: 'GET',
      headers: { authorization: this.token },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new SourceError('import_source_failed', `Download failed (HTTP ${response.status})`);
    }
    return {
      data: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }
}
