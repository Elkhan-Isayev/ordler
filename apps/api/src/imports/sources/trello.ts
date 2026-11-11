import type { ImportContainer, IssueStatusCategory } from '@ordler/shared';
import {
  SourceError,
  sourceJson,
  type ExternalAttachment,
  type ExternalIssue,
  type ExternalPerson,
  type HttpFetch,
  type ImportSourceAdapter,
} from './types.js';

const API = 'https://api.trello.com/1';
const PAGE_SIZE = 50;
/** Status of archived cards and cards in archived lists; admins map it like any list. */
export const ARCHIVED = 'Archived';
/** Uploaded files are served from these hosts and need the credentials to download. */
const DOWNLOAD_HOSTS = new Set(['trello.com', 'api.trello.com']);

/** Trello lists are free-form, so their kind is guessed from common names. */
const CATEGORY_PATTERNS: Array<[IssueStatusCategory, RegExp]> = [
  [
    'completed',
    /\b(done|complete[d]?|finished|closed|shipped|released)\b|готов|сделан|завершен|erledigt|fertig|hazır|tamamlan/i,
  ],
  ['canceled', /\b(cancel+ed|won'?t do|rejected|dropped)\b|отмен|отклон|abgebrochen|ləğv/i],
  [
    'started',
    /\b(doing|in progress|wip|review|testing|qa|working)\b|в работе|в процессе|ревью|тест|in arbeit|icrada|davam/i,
  ],
  ['backlog', /\b(backlog|ideas?|someday|icebox)\b|бэклог|идеи|ideen|ideyalar/i],
];

export function listCategory(name: string): IssueStatusCategory {
  return CATEGORY_PATTERNS.find(([, pattern]) => pattern.test(name))?.[0] ?? 'unstarted';
}

/** A team key suggestion from a board name: initials of Latin words, else the first letters. */
export function boardKey(name: string): string {
  const words = name
    .normalize('NFKD')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((word) => /^[A-Z]/.test(word));
  const initials = words.map((w) => w[0]).join('');
  const key = (words.length > 1 ? initials : (words[0] ?? '')).slice(0, 6);
  return key.length >= 2 ? key : 'TRELLO';
}

/** Trello ids are MongoDB ObjectIds: the first 8 hex digits are the creation time. */
export function createdAtOf(id: string): string {
  const seconds = Number.parseInt(id.slice(0, 8), 16);
  return new Date(Number.isFinite(seconds) ? seconds * 1000 : 0).toISOString();
}

interface TrelloMember {
  fullName?: string | null;
  username: string;
}

function person(member: TrelloMember | null | undefined): ExternalPerson | null {
  if (!member) return null;
  // Trello hides emails from the API, so the unique username keys the people map.
  return { id: `@${member.username}`, name: member.fullName || member.username, email: null };
}

interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
}

interface TrelloCard {
  id: string;
  idShort: number;
  name: string;
  desc: string;
  closed: boolean;
  idList: string;
  url: string;
  due: string | null;
  start?: string | null;
  dateLastActivity: string;
  badges?: { comments?: number };
  labels?: Array<{ name: string; color: string | null }>;
  members?: TrelloMember[];
  attachments?: Array<{
    id: string;
    name: string;
    url: string;
    bytes: number | null;
    isUpload: boolean;
  }>;
  checklists?: Array<{
    name: string;
    pos: number;
    checkItems: Array<{ name: string; state: 'complete' | 'incomplete'; pos: number }>;
  }>;
}

interface TrelloComment {
  id: string;
  date: string;
  data: { text: string };
  memberCreator?: TrelloMember | null;
}

/** Checklists become Markdown task lists under the card description. */
function checklistMarkdown(card: TrelloCard): string {
  return [...(card.checklists ?? [])]
    .sort((a, b) => a.pos - b.pos)
    .map((list) => {
      const items = [...list.checkItems]
        .sort((a, b) => a.pos - b.pos)
        .map((item) => `- [${item.state === 'complete' ? 'x' : ' '}] ${item.name}`);
      return [`### ${list.name}`, ...items].join('\n');
    })
    .join('\n\n');
}

function downloadable(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && DOWNLOAD_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Trello's REST API with an API key and a user token (ADR 0016). A board is a container, its
 * lists are statuses, cards are issues. The credentials travel in the OAuth header, never in
 * URLs, so they cannot leak into proxy or access logs.
 */
export class TrelloSource implements ImportSourceAdapter {
  private readonly auth: string;

  constructor(
    credentials: { apiKey: string; token: string },
    private readonly fetch: HttpFetch,
  ) {
    this.auth = `OAuth oauth_consumer_key="${credentials.apiKey}", oauth_token="${credentials.token}"`;
  }

  private get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const params = new URLSearchParams(query).toString();
    return sourceJson(this.fetch, `${API}${path}${params ? `?${params}` : ''}`, {
      headers: { authorization: this.auth },
    }) as Promise<T>;
  }

  async account() {
    const me = await this.get<TrelloMember & { email?: string | null }>('/members/me', {
      fields: 'fullName,username,email',
    });
    return { name: me.fullName || me.username, email: me.email ?? null };
  }

  async containers(): Promise<ImportContainer[]> {
    const boards = await this.get<Array<{ id: string; name: string; lists?: TrelloList[] }>>(
      '/members/me/boards',
      { filter: 'open', fields: 'name', lists: 'all', list_fields: 'name,closed' },
    );
    return boards.map((board) => {
      const names = [...new Set((board.lists ?? []).filter((l) => !l.closed).map((l) => l.name))];
      return {
        id: board.id,
        key: boardKey(board.name),
        name: board.name,
        statuses: [
          ...names.map((name) => ({ name, category: listCategory(name) })),
          { name: ARCHIVED, category: 'canceled' as const },
        ],
      };
    });
  }

  async people(containerIds: string[]): Promise<ExternalPerson[]> {
    const seen = new Map<string, ExternalPerson>();
    for (const id of containerIds) {
      const members = await this.get<TrelloMember[]>(`/boards/${encodeURIComponent(id)}/members`, {
        fields: 'fullName,username',
      });
      for (const member of members) {
        const p = person(member)!;
        seen.set(p.id, p);
      }
    }
    return [...seen.values()];
  }

  async page(
    container: ImportContainer,
    cursor: string | null,
    options: { includeClosed: boolean },
  ) {
    const board = encodeURIComponent(container.id);
    const [lists, all] = await Promise.all([
      this.get<TrelloList[]>(`/boards/${board}/lists`, { filter: 'all', fields: 'name,closed' }),
      this.get<TrelloCard[]>(`/boards/${board}/cards/${options.includeClosed ? 'all' : 'open'}`, {
        fields: 'idShort,name,desc,closed,idList,url,due,start,dateLastActivity,badges,labels',
        members: 'true',
        member_fields: 'fullName,username',
        attachments: 'true',
        attachment_fields: 'name,url,bytes,isUpload',
        checklists: 'all',
      }),
    ]);
    const listById = new Map(lists.map((l) => [l.id, l]));
    // Trello has no stable cursor over a board's cards; ids grow with time, so they order them.
    const cards = all
      .filter((card) => cursor === null || card.id > cursor)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const batch = cards.slice(0, PAGE_SIZE);

    const issues: ExternalIssue[] = [];
    for (const card of batch) {
      const list = listById.get(card.idList);
      const archived = card.closed || !list || list.closed;
      if (archived && !options.includeClosed) continue;
      const comments =
        (card.badges?.comments ?? 0) > 0
          ? await this.get<TrelloComment[]>(`/cards/${encodeURIComponent(card.id)}/actions`, {
              filter: 'commentCard',
              limit: '1000',
              memberCreator_fields: 'fullName,username',
            })
          : [];
      issues.push(this.issue(container, card, list, archived, comments));
    }
    return { issues, next: cards.length > PAGE_SIZE ? batch[batch.length - 1]!.id : null };
  }

  private issue(
    container: ImportContainer,
    card: TrelloCard,
    list: TrelloList | undefined,
    archived: boolean,
    comments: TrelloComment[],
  ): ExternalIssue {
    const uploads: ExternalAttachment[] = [];
    const links: string[] = [];
    for (const file of card.attachments ?? []) {
      if (file.isUpload && downloadable(file.url)) {
        uploads.push({
          ref: file.url,
          filename: file.name || 'file',
          url: file.url,
          size: file.bytes,
        });
      } else if (/^https?:\/\//.test(file.url)) {
        links.push(`- [${file.name || file.url}](${file.url})`);
      }
    }
    const description = [card.desc.trim(), checklistMarkdown(card), links.join('\n')]
      .filter(Boolean)
      .join('\n\n');
    const status = archived
      ? { name: ARCHIVED, category: 'canceled' as const }
      : { name: list!.name, category: listCategory(list!.name) };
    return {
      externalId: card.id,
      key: `${container.key}-${card.idShort}`,
      url: card.url,
      title: card.name.trim().slice(0, 500) || `${container.key}-${card.idShort}`,
      description,
      status,
      priority: 'none',
      assignees: (card.members ?? []).map((m) => person(m)!),
      creator: null,
      labels: (card.labels ?? []).map((l) => l.name || l.color || '').filter(Boolean),
      dueDate: card.due ? card.due.slice(0, 10) : null,
      createdAt: createdAtOf(card.id),
      updatedAt: card.dateLastActivity,
      parentExternalId: null,
      // The API lists newest first; Ordler shows comments oldest first.
      comments: [...comments].reverse().map((c) => ({
        externalId: c.id,
        author: person(c.memberCreator),
        body: c.data.text,
        createdAt: c.date,
      })),
      attachments: uploads,
      dropped: card.start ? ['startDate'] : [],
    };
  }

  async download(url: string) {
    // Never send the credentials anywhere but Trello itself.
    if (!downloadable(url)) {
      throw new SourceError('import_source_failed', 'Refusing to download from outside Trello');
    }
    const response = await this.fetch(url, {
      method: 'GET',
      headers: { authorization: this.auth },
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
