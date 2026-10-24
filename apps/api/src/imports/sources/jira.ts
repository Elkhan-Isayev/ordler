import type { ImportContainer, IssueStatusCategory, Priority } from '@ordler/shared';
import { adfToMarkdown, wikiToMarkdown } from '../markdown.js';
import {
  SourceError,
  sourceJson,
  type ExternalIssue,
  type ExternalPerson,
  type HttpFetch,
  type ImportSourceAdapter,
} from './types.js';

const PAGE = 50;
const FIELDS = [
  'summary',
  'description',
  'status',
  'priority',
  'assignee',
  'reporter',
  'creator',
  'labels',
  'components',
  'issuetype',
  'duedate',
  'created',
  'updated',
  'parent',
  'resolution',
  'comment',
  'attachment',
  'timeoriginalestimate',
  'issuelinks',
];
const CATEGORY: Record<string, IssueStatusCategory> = {
  new: 'unstarted',
  indeterminate: 'started',
  done: 'completed',
};
const PRIORITY: Record<string, Priority> = {
  highest: 'urgent',
  blocker: 'urgent',
  critical: 'urgent',
  high: 'high',
  major: 'high',
  medium: 'medium',
  low: 'low',
  minor: 'low',
  lowest: 'low',
  trivial: 'low',
};
/** Resolutions that mean "not done" rather than completed. */
const CANCELED = /won'?t|duplicate|declined|cannot reproduce|incomplete|obsolete/i;

interface JiraUser {
  displayName?: string;
  emailAddress?: string;
  name?: string;
}

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: unknown;
    status: { name: string; statusCategory: { key: string } };
    priority: { name: string } | null;
    assignee: JiraUser | null;
    reporter: JiraUser | null;
    creator: JiraUser | null;
    labels: string[];
    components: Array<{ name: string }>;
    issuetype: { name: string; subtask?: boolean } | null;
    duedate: string | null;
    created: string;
    updated: string;
    parent?: { id: string };
    resolution: { name: string } | null;
    comment?: {
      comments: Array<{ id: string; author: JiraUser | null; body: unknown; created: string }>;
    };
    attachment?: Array<{ id: string; filename: string; content: string; size: number }>;
    timeoriginalestimate?: number | null;
    issuelinks?: unknown[];
  };
}

function person(user: JiraUser | null | undefined): ExternalPerson | null {
  if (!user) return null;
  const name = user.displayName ?? user.name ?? 'Unknown';
  const email = user.emailAddress || null;
  return { id: email ?? name, name, email };
}

/** Jira Cloud (REST v3, email + API token) or Server/DC (REST v2, personal access token). */
export class JiraSource implements ImportSourceAdapter {
  private readonly cloud: boolean;
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly credentials: { email?: string | undefined; token: string },
    private readonly fetch: HttpFetch,
  ) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.cloud = Boolean(credentials.email);
  }

  private get api(): string {
    return `${this.base}/rest/api/${this.cloud ? 3 : 2}`;
  }

  private get headers(): Record<string, string> {
    return {
      authorization: this.cloud
        ? `Basic ${Buffer.from(`${this.credentials.email}:${this.credentials.token}`).toString('base64')}`
        : `Bearer ${this.credentials.token}`,
    };
  }

  private get<T>(path: string): Promise<T> {
    return sourceJson(this.fetch, `${this.api}${path}`, { headers: this.headers }) as Promise<T>;
  }

  private text(value: unknown): string {
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? wikiToMarkdown(value) : adfToMarkdown(value);
  }

  async account() {
    const me = await this.get<JiraUser>('/myself');
    return { name: me.displayName ?? me.name ?? 'Jira', email: me.emailAddress || null };
  }

  async containers(): Promise<ImportContainer[]> {
    const projects: Array<{ id: string; key: string; name: string }> = [];
    if (this.cloud) {
      let startAt = 0;
      for (;;) {
        const page = await this.get<{
          values: Array<{ id: string; key: string; name: string }>;
          isLast: boolean;
        }>(`/project/search?startAt=${startAt}&maxResults=50`);
        projects.push(...page.values);
        if (page.isLast || page.values.length === 0) break;
        startAt += page.values.length;
      }
    } else {
      projects.push(
        ...(await this.get<Array<{ id: string; key: string; name: string }>>('/project')),
      );
    }
    const result: ImportContainer[] = [];
    for (const project of projects) {
      const types = await this.get<
        Array<{ statuses: Array<{ name: string; statusCategory: { key: string } }> }>
      >(`/project/${encodeURIComponent(project.key)}/statuses`);
      const statuses = new Map<string, IssueStatusCategory>();
      for (const type of types) {
        for (const s of type.statuses)
          statuses.set(s.name, CATEGORY[s.statusCategory.key] ?? 'unstarted');
      }
      result.push({
        id: project.id,
        key: project.key,
        name: project.name,
        statuses: [...statuses].map(([name, category]) => ({ name, category })),
      });
    }
    return result;
  }

  async people(containerIds: string[]): Promise<ExternalPerson[]> {
    const seen = new Map<string, ExternalPerson>();
    for (const id of containerIds) {
      for (let startAt = 0; ; startAt += PAGE) {
        const users = await this.get<JiraUser[]>(
          `/user/assignable/search?project=${encodeURIComponent(id)}&startAt=${startAt}&maxResults=${PAGE}`,
        );
        for (const user of users) {
          const p = person(user)!;
          seen.set(p.id, p);
        }
        if (users.length < PAGE) break;
      }
    }
    return [...seen.values()];
  }

  async page(
    container: ImportContainer,
    cursor: string | null,
    options: { includeClosed: boolean; jql?: string | undefined },
  ) {
    const clauses = [`project = ${container.id}`];
    if (!options.includeClosed) clauses.push('statusCategory != Done');
    if (options.jql?.trim()) clauses.push(`(${options.jql.trim()})`);
    const jql = `${clauses.join(' AND ')} ORDER BY created ASC`;

    let issues: JiraIssue[];
    let next: string | null;
    if (this.cloud) {
      // The enhanced search pages by token; the old startAt search is retired on Cloud.
      const result = (await sourceJson(this.fetch, `${this.api}/search/jql`, {
        method: 'POST',
        headers: this.headers,
        body: {
          jql,
          fields: FIELDS,
          maxResults: PAGE,
          ...(cursor ? { nextPageToken: cursor } : {}),
        },
      })) as { issues: JiraIssue[]; nextPageToken?: string; isLast?: boolean };
      issues = result.issues;
      next = result.nextPageToken && result.isLast !== true ? result.nextPageToken : null;
    } else {
      const startAt = Number(cursor ?? 0);
      const result = (await sourceJson(this.fetch, `${this.api}/search`, {
        method: 'POST',
        headers: this.headers,
        body: { jql, fields: FIELDS, maxResults: PAGE, startAt },
      })) as { issues: JiraIssue[]; total: number };
      issues = result.issues;
      next =
        startAt + issues.length < result.total && issues.length > 0
          ? String(startAt + issues.length)
          : null;
    }

    return {
      issues: await Promise.all(issues.map((issue) => this.convert(issue))),
      next,
    };
  }

  private async convert(issue: JiraIssue): Promise<ExternalIssue> {
    const f = issue.fields;
    let comments = f.comment?.comments ?? [];
    // Search returns at most 20 comments per issue; fetch the rest when there are more.
    if (
      f.comment &&
      'total' in f.comment &&
      (f.comment as { total: number }).total > comments.length
    ) {
      const all = await this.get<{ comments: typeof comments }>(
        `/issue/${issue.id}/comment?maxResults=1000`,
      );
      comments = all.comments;
    }
    const category = CATEGORY[f.status.statusCategory.key] ?? 'unstarted';
    const canceled = category === 'completed' && f.resolution && CANCELED.test(f.resolution.name);
    const assignee = person(f.assignee);
    return {
      externalId: issue.id,
      key: issue.key,
      url: `${this.base}/browse/${issue.key}`,
      title: f.summary,
      description: this.text(f.description),
      status: { name: f.status.name, category: canceled ? 'canceled' : category },
      priority: PRIORITY[f.priority?.name.toLowerCase() ?? ''] ?? 'none',
      assignees: assignee ? [assignee] : [],
      creator: person(f.reporter ?? f.creator),
      labels: [
        ...(f.issuetype ? [`type:${f.issuetype.name}`] : []),
        ...f.labels,
        ...f.components.map((c) => c.name),
      ],
      dueDate: f.duedate,
      createdAt: new Date(f.created).toISOString(),
      updatedAt: new Date(f.updated).toISOString(),
      parentExternalId: f.parent?.id ?? null,
      comments: comments.map((c) => ({
        externalId: c.id,
        author: person(c.author),
        body: this.text(c.body),
        createdAt: new Date(c.created).toISOString(),
      })),
      attachments: (f.attachment ?? []).map((a) => ({
        ref: a.filename,
        filename: a.filename,
        url: a.content,
        size: a.size,
      })),
      dropped: [
        ...(f.timeoriginalestimate ? ['estimate'] : []),
        ...(f.issuelinks?.length ? ['links'] : []),
      ],
    };
  }

  async download(url: string) {
    if (!url.startsWith(this.base)) {
      throw new SourceError('import_source_failed', 'Attachment is outside the Jira site');
    }
    const response = await this.fetch(url, { method: 'GET', headers: this.headers });
    if (response.status < 200 || response.status >= 300) {
      throw new SourceError('import_source_failed', `Download failed (HTTP ${response.status})`);
    }
    return {
      data: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }
}
