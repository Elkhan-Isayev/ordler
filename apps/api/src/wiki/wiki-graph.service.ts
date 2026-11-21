import {
  WIKI_LINK_PATTERN,
  WIKI_MAX_RELATIONS,
  guessWikiTarget,
  wikiLinkFromGroups,
  wikiLinks,
  wikiRelationCreateSchema,
  type WikiGraph,
  type WikiGraphEdge,
  type WikiGraphNode,
  type WikiLink,
  type WikiRelationCreate,
  type WikiRelationNode,
  type WikiRelationTarget,
  type WikiRelationType,
  type WikiRelationView,
} from '@ordler/shared';
import { and, asc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import { wikiFolders, wikiPages, wikiRelations } from '../db/schema.js';
import type { WikiPermissions } from './wiki-access.js';
import type { WikiService } from './wiki.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Linked issues, requests and boards on one map; each costs an access check. */
export const WIKI_GRAPH_MAX_EXTERNAL = 300;
const RESOLVE_BATCH = 20;

/** An issue, request or board the member may open, as a graph node shows it. */
export interface ExternalTarget {
  /** Canonical reference: issue or request number, whiteboard id. */
  ref: string;
  label: string;
}

/** Access-checked lookups into other modules; null when missing or not readable. */
export interface WikiTargetResolver {
  issue(memberId: string, ref: string): Promise<ExternalTarget | null>;
  /** Many issues in one go by identifier: null when hidden; refs it misses fall back to `issue`. */
  issues(memberId: string, refs: string[]): Promise<Map<string, ExternalTarget | null>>;
  /** Many requests in one go by identifier: null when hidden; misses fall back to `request`. */
  requests(memberId: string, refs: string[]): Promise<Map<string, ExternalTarget | null>>;
  request(memberId: string, ref: string): Promise<ExternalTarget | null>;
  whiteboard(memberId: string, ref: string): Promise<ExternalTarget | null>;
}

export interface WikiGraphServiceDeps {
  db: Db;
  wiki: WikiService;
  targets: WikiTargetResolver;
}

interface PageInfo {
  id: string;
  title: string;
  departmentId: string;
  folderId: string | null;
}

/** The readable wiki of one member, loaded once per call. */
interface Snapshot {
  memberId: string;
  spaces: Map<string, { name: string; can: WikiPermissions }>;
  pages: Map<string, PageInfo>;
  byTitle: Map<string, PageInfo[]>;
  external: Map<string, Promise<ExternalTarget | null>>;
}

export interface WikiContextOptions {
  /** Start from the pages that match these words… */
  query?: string;
  /** …or from these pages… */
  pages?: string[];
  /** …or from the pages about this issue (`HELP-12`)… */
  issue?: string;
  /** …or about this request (`REQ-3`). */
  request?: string;
  /** How many relation hops to follow from the starting pages. */
  depth: number;
  /** At most this many pages come back. */
  limit: number;
  /** Total characters of page text; each page gets a fair share. */
  maxChars: number;
}

export interface WikiContextPage {
  id: string;
  title: string;
  department: string;
  folder: string | null;
  /** Hops from the nearest starting page (0 = a starting page). */
  distance: number;
  content: string;
  truncated: boolean;
}

export interface WikiContext {
  pages: WikiContextPage[];
  /** Relations between the returned pages and to linked issues, requests and boards. */
  relations: Array<{ from: string; type: WikiRelationType; to: string }>;
  /** Issues, requests and boards the returned pages point at. */
  linked: Array<{ kind: WikiRelationTarget; ref: string; label: string }>;
}

function hrefOf(kind: WikiRelationTarget, ref: string): string {
  switch (kind) {
    case 'wiki_page':
      return `/wiki/page/${ref}`;
    case 'whiteboard':
      return `/whiteboards/${ref}`;
    case 'issue':
      return `/issue/${ref}`;
    case 'request':
      return `/requests/${ref}`;
  }
}

/** Escapes LIKE wildcards so the text matches literally. */
function likeText(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Relations between wiki pages and the wiki map (SPEC §5.6, ADR 0018). Stored relations are
 * typed and added by people or agents; links in page text are read on the fly. Everything a
 * member gets is filtered by what they may read: pages by wiki access, issues, requests and
 * boards by their own modules.
 */
export class WikiGraphService {
  constructor(private readonly deps: WikiGraphServiceDeps) {}

  private get db(): Db {
    return this.deps.db;
  }

  /** Relations of one page, both directions, stored and from links. */
  async relations(memberId: string, pageId: string): Promise<WikiRelationView[]> {
    const row = await this.deps.wiki.pageRow(pageId);
    const { can } = await this.deps.wiki.readable(memberId, row.departmentId);
    const snap = await this.snapshot(memberId);
    const views: WikiRelationView[] = [];

    const stored = await this.db
      .select()
      .from(wikiRelations)
      .where(eq(wikiRelations.pageId, row.id))
      .orderBy(asc(wikiRelations.createdAt));
    for (const relation of stored) {
      const node = await this.node(snap, relation.targetKind, relation.targetRef);
      if (!node) continue;
      views.push({
        id: relation.id,
        type: relation.type,
        direction: 'out',
        origin: 'manual',
        node,
        note: relation.note,
        canRemove: can.edit,
      });
    }
    // `[[Title]]` and `/wiki/page/<id>` may name the same page: one entry each.
    const linked = new Set<string>();
    for (const link of wikiLinks(row.content)) {
      const node = await this.linkNode(snap, link, row.departmentId);
      if (!node || (node.kind === 'wiki_page' && node.ref === row.id)) continue;
      if (linked.has(`${node.kind}:${node.ref}`)) continue;
      linked.add(`${node.kind}:${node.ref}`);
      views.push(linkView('out', node));
    }

    const incoming = await this.db
      .select({ relation: wikiRelations, departmentId: wikiPages.departmentId })
      .from(wikiRelations)
      .innerJoin(wikiPages, eq(wikiPages.id, wikiRelations.pageId))
      .where(
        and(
          eq(wikiRelations.targetKind, 'wiki_page'),
          eq(wikiRelations.targetRef, row.id),
          isNull(wikiPages.archivedAt),
        ),
      )
      .orderBy(asc(wikiRelations.createdAt));
    for (const { relation } of incoming) {
      const source = snap.pages.get(relation.pageId);
      if (!source) continue;
      views.push({
        id: relation.id,
        type: relation.type,
        direction: 'in',
        origin: 'manual',
        node: this.pageNode(snap, source),
        note: relation.note,
        canRemove: snap.spaces.get(source.departmentId)?.can.edit ?? false,
      });
    }
    for (const source of await this.pagesLinkingTo(snap, row)) {
      views.push(linkView('in', this.pageNode(snap, source)));
    }
    return views;
  }

  async addRelation(
    memberId: string,
    pageId: string,
    raw: WikiRelationCreate,
    via?: string,
  ): Promise<WikiRelationView[]> {
    const input = wikiRelationCreateSchema.parse(raw);
    const row = await this.deps.wiki.pageRow(pageId);
    const { can } = await this.deps.wiki.readable(memberId, row.departmentId);
    if (!can.edit) throw new DomainError('forbidden');
    const snap = await this.snapshot(memberId);
    const kind = input.targetKind ?? guessWikiTarget(input.target);
    const node = await this.target(snap, kind, input.target, row.departmentId);
    // A target the member cannot see is refused like a typo, so it does not leak.
    if (!node) throw new DomainError('validation_failed');
    if (node.kind === 'wiki_page' && node.ref === row.id) {
      throw new DomainError('validation_failed');
    }
    const existing = await this.db
      .select({ id: wikiRelations.id })
      .from(wikiRelations)
      .where(eq(wikiRelations.pageId, row.id));
    if (existing.length >= WIKI_MAX_RELATIONS) throw new DomainError('validation_failed');
    const [created] = await this.db
      .insert(wikiRelations)
      .values({
        pageId: row.id,
        targetKind: node.kind,
        targetRef: node.ref,
        type: input.type,
        note: input.note || null,
        createdBy: memberId,
      })
      .onConflictDoNothing()
      .returning();
    if (created) {
      await writeAudit(this.db, {
        actor: { type: 'member', id: memberId },
        action: 'wiki.relation_added',
        targetType: 'wiki_page',
        targetId: row.id,
        after: {
          relationId: created.id,
          targetKind: node.kind,
          targetRef: node.ref,
          type: input.type,
          ...(via ? { via } : {}),
        },
      });
    }
    return this.relations(memberId, row.id);
  }

  async removeRelation(memberId: string, relationId: string, via?: string): Promise<void> {
    if (!UUID.test(relationId)) throw new DomainError('not_found');
    const [relation] = await this.db
      .select()
      .from(wikiRelations)
      .where(eq(wikiRelations.id, relationId));
    if (!relation) throw new DomainError('not_found');
    const row = await this.deps.wiki.pageRow(relation.pageId);
    const { can } = await this.deps.wiki.readable(memberId, row.departmentId);
    if (!can.edit) throw new DomainError('forbidden');
    await this.db.delete(wikiRelations).where(eq(wikiRelations.id, relation.id));
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action: 'wiki.relation_removed',
      targetType: 'wiki_page',
      targetId: row.id,
      before: {
        relationId: relation.id,
        targetKind: relation.targetKind,
        targetRef: relation.targetRef,
        type: relation.type,
      },
      ...(via ? { after: { via } } : {}),
    });
  }

  /**
   * The readable wiki as a graph: departments and folders are cluster nodes (`in` edges),
   * pages link to pages, issues, requests and boards. One department narrows the map.
   */
  async graph(memberId: string, departmentId?: string): Promise<WikiGraph> {
    const snap = await this.snapshot(memberId);
    if (departmentId !== undefined && !snap.spaces.has(departmentId)) {
      throw new DomainError('not_found');
    }
    const inScope = (id: string) => departmentId === undefined || id === departmentId;
    const scope = [...snap.spaces.keys()].filter(inScope);
    const nodes = new Map<string, WikiGraphNode>();
    const edges = new Map<string, WikiGraphEdge>();
    const addEdge = (source: string, target: string, type: WikiGraphEdge['type']) => {
      if (source === target || !nodes.has(source) || !nodes.has(target)) return;
      edges.set(`${source}|${target}|${type}`, { source, target, type });
    };
    if (scope.length === 0) return { nodes: [], edges: [], truncated: false };

    for (const id of scope) {
      nodes.set(`department:${id}`, {
        id: `department:${id}`,
        kind: 'department',
        label: snap.spaces.get(id)!.name,
        href: `/wiki/${id}`,
        departmentId: id,
      });
    }
    const folders = await this.db
      .select()
      .from(wikiFolders)
      .where(inArray(wikiFolders.departmentId, scope));
    for (const folder of folders) {
      nodes.set(`folder:${folder.id}`, {
        id: `folder:${folder.id}`,
        kind: 'folder',
        label: folder.name,
        href: `/wiki/${folder.departmentId}`,
        departmentId: folder.departmentId,
      });
    }
    for (const folder of folders) {
      const parent = folder.parentId
        ? `folder:${folder.parentId}`
        : `department:${folder.departmentId}`;
      addEdge(`folder:${folder.id}`, parent, 'in');
    }
    for (const page of snap.pages.values()) {
      if (!inScope(page.departmentId)) continue;
      const id = `wiki_page:${page.id}`;
      nodes.set(id, {
        id,
        kind: 'wiki_page',
        label: page.title,
        href: hrefOf('wiki_page', page.id),
        departmentId: page.departmentId,
      });
      addEdge(
        id,
        page.folderId && nodes.has(`folder:${page.folderId}`)
          ? `folder:${page.folderId}`
          : `department:${page.departmentId}`,
        'in',
      );
    }

    // Every outgoing pointer of the pages in scope: stored relations, then links in the text.
    const pointers: Array<{ from: PageInfo; link: WikiLink; type: WikiRelationType }> = [];
    const stored = await this.db
      .select({ relation: wikiRelations })
      .from(wikiRelations)
      .innerJoin(wikiPages, eq(wikiPages.id, wikiRelations.pageId))
      .where(and(inArray(wikiPages.departmentId, scope), isNull(wikiPages.archivedAt)));
    for (const { relation } of stored) {
      const from = snap.pages.get(relation.pageId);
      if (from) {
        pointers.push({
          from,
          link: { kind: relation.targetKind, ref: relation.targetRef },
          type: relation.type,
        });
      }
    }
    for (const { pageId, link } of await this.linksIn(scope)) {
      const from = snap.pages.get(pageId);
      if (from) pointers.push({ from, link, type: 'references' });
    }

    // Issues, requests and boards are checked once each, in parallel, up to the limit.
    const externalKeys = [
      ...new Set(
        pointers
          .filter((p) => p.link.kind !== 'wiki_page')
          .map((p) => `${p.link.kind}:${p.link.ref}`),
      ),
    ];
    const truncated = externalKeys.length > WIKI_GRAPH_MAX_EXTERNAL;
    const allowed = new Set(externalKeys.slice(0, WIKI_GRAPH_MAX_EXTERNAL));
    // Issues and requests are most of the targets: one batch each instead of one lookup each,
    // which took thousands of queries for a company map. Whatever a batch misses (hidden, or an
    // imported issue key) is looked up one by one below.
    for (const kind of ['issue', 'request'] as const) {
      const refs = [...allowed]
        .filter((k) => k.startsWith(`${kind}:`))
        .map((k) => k.slice(kind.length + 1));
      if (refs.length === 0) continue;
      const found =
        kind === 'issue'
          ? await this.deps.targets.issues(snap.memberId, refs)
          : await this.deps.targets.requests(snap.memberId, refs);
      for (const [ref, target] of found) {
        snap.external.set(`${kind}:${ref}`, Promise.resolve(target));
      }
    }
    for (let i = 0; i < externalKeys.length && i < WIKI_GRAPH_MAX_EXTERNAL; i += RESOLVE_BATCH) {
      await Promise.all(
        externalKeys.slice(i, i + RESOLVE_BATCH).map((key) => {
          const at = key.indexOf(':');
          return this.external(snap, key.slice(0, at) as WikiRelationTarget, key.slice(at + 1));
        }),
      );
    }

    for (const { from, link, type } of pointers) {
      const source = `wiki_page:${from.id}`;
      if (link.kind === 'wiki_page') {
        const target = link.byTitle
          ? this.pageByTitle(snap, link.ref, from.departmentId)
          : snap.pages.get(link.ref);
        if (target) addEdge(source, `wiki_page:${target.id}`, type);
        continue;
      }
      const key = `${link.kind}:${link.ref}`;
      if (!allowed.has(key)) continue;
      const found = await this.external(snap, link.kind, link.ref);
      if (!found) continue;
      const id = `${link.kind}:${found.ref}`;
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          kind: link.kind,
          label: found.label,
          href: hrefOf(link.kind, found.ref),
          departmentId: null,
        });
      }
      addEdge(source, id, type);
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()], truncated };
  }

  /**
   * Context for an AI client: the starting pages and what they relate to, a few hops out,
   * with their text within a character budget (ADR 0018, like Graphify over the wiki).
   */
  /**
   * Readable pages about an issue, request or whiteboard: those with a stored relation to it or a
   * link to it in their text, by title. not_found when the member may not open the target.
   */
  async pagesAbout(
    memberId: string,
    kind: Exclude<WikiRelationTarget, 'wiki_page'>,
    ref: string,
  ): Promise<Array<{ id: string; title: string; department: { id: string; name: string } }>> {
    const snap = await this.snapshot(memberId);
    const target = await this.external(
      snap,
      kind,
      kind === 'whiteboard' ? ref.trim() : ref.trim().toUpperCase(),
    );
    if (!target) throw new DomainError('not_found');
    if (snap.spaces.size === 0) return [];
    const stored = await this.db
      .select({ pageId: wikiRelations.pageId })
      .from(wikiRelations)
      .where(and(eq(wikiRelations.targetKind, kind), eq(wikiRelations.targetRef, target.ref)));
    const path =
      kind === 'issue'
        ? `/issue/${target.ref}`
        : kind === 'request'
          ? `/requests/${target.ref}`
          : `/whiteboards/${target.ref}`;
    const candidates = await this.db
      .select({ id: wikiPages.id, content: wikiPages.content })
      .from(wikiPages)
      .where(
        and(
          inArray(wikiPages.departmentId, [...snap.spaces.keys()]),
          isNull(wikiPages.archivedAt),
          ilike(wikiPages.content, `%${likeText(path)}%`),
        ),
      );
    const ids = new Set(stored.map((r) => r.pageId));
    // The same parser as everywhere else decides, so /issue/HELP-10 is not about HELP-1.
    for (const candidate of candidates) {
      const links = wikiLinks(candidate.content);
      if (links.some((l) => l.kind === kind && l.ref.toUpperCase() === target.ref.toUpperCase())) {
        ids.add(candidate.id);
      }
    }
    return [...ids]
      .map((id) => snap.pages.get(id))
      .filter((p) => p !== undefined)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((p) => ({
        id: p.id,
        title: p.title,
        department: { id: p.departmentId, name: snap.spaces.get(p.departmentId)!.name },
      }));
  }

  async context(memberId: string, options: WikiContextOptions): Promise<WikiContext> {
    const graph = await this.graph(memberId);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    let seeds = (options.pages ?? []).map((id) => `wiki_page:${id}`).filter((id) => byId.has(id));
    // A task as the starting point: the pages written about it, for an agent working on it.
    for (const [kind, ref] of [
      ['issue', options.issue],
      ['request', options.request],
    ] as const) {
      if (ref === undefined) continue;
      for (const about of await this.pagesAbout(memberId, kind, ref)) {
        const id = `wiki_page:${about.id}`;
        if (byId.has(id) && !seeds.includes(id)) seeds.push(id);
      }
    }
    if (seeds.length === 0 && options.query) {
      const hits = await this.deps.wiki.searchForAgents(memberId, options.query, { limit: 5 });
      seeds = hits.slice(0, 5).map((h) => `wiki_page:${h.id}`);
    }
    if (seeds.length === 0) return { pages: [], relations: [], linked: [] };

    const neighbours = new Map<string, string[]>();
    const parentOf = new Map<string, string>();
    for (const edge of graph.edges) {
      if (edge.type === 'in') {
        parentOf.set(edge.source, edge.target);
        continue;
      }
      for (const [from, to] of [
        [edge.source, edge.target],
        [edge.target, edge.source],
      ] as const) {
        const list = neighbours.get(from);
        if (list) list.push(to);
        else neighbours.set(from, [to]);
      }
    }
    // Breadth first: nearer pages win when the limit cuts the list.
    const distance = new Map(seeds.map((id) => [id, 0]));
    let frontier = seeds;
    for (let hop = 1; hop <= options.depth && frontier.length > 0; hop++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const other of neighbours.get(id) ?? []) {
          if (distance.has(other)) continue;
          distance.set(other, hop);
          // Issues and boards are leaves: the walk goes on through pages only.
          if (byId.get(other)?.kind === 'wiki_page') next.push(other);
        }
      }
      frontier = next;
    }
    const pageIds = [...distance.entries()]
      .filter(([id]) => byId.get(id)?.kind === 'wiki_page')
      .sort((a, b) => a[1] - b[1])
      .slice(0, options.limit)
      .map(([id]) => id);
    const included = new Set(pageIds);

    const rows = await this.db
      .select({ id: wikiPages.id, content: wikiPages.content })
      .from(wikiPages)
      .where(
        inArray(
          wikiPages.id,
          pageIds.map((id) => id.slice('wiki_page:'.length)),
        ),
      );
    const contentOf = new Map(rows.map((r) => [r.id, r.content]));
    const share = Math.max(500, Math.floor(options.maxChars / Math.max(1, pageIds.length)));
    const folderPath = (id: string): string | null => {
      const names: string[] = [];
      let current = parentOf.get(id);
      while (current?.startsWith('folder:') && names.length < 32) {
        names.unshift(byId.get(current)!.label);
        current = parentOf.get(current);
      }
      return names.length > 0 ? names.join('/') : null;
    };

    const pages = pageIds.map((id) => {
      const node = byId.get(id)!;
      const text = contentOf.get(id.slice('wiki_page:'.length)) ?? '';
      return {
        id: id.slice('wiki_page:'.length),
        title: node.label,
        department: byId.get(`department:${node.departmentId}`)?.label ?? '',
        folder: folderPath(id),
        distance: distance.get(id)!,
        content: text.length > share ? `${text.slice(0, share)}…` : text,
        truncated: text.length > share,
      };
    });
    const linked = new Map<string, WikiGraphNode>();
    const relations: WikiContext['relations'] = [];
    for (const edge of graph.edges) {
      if (edge.type === 'in' || !included.has(edge.source)) continue;
      const target = byId.get(edge.target)!;
      if (target.kind === 'wiki_page' && !included.has(target.id)) continue;
      if (target.kind !== 'wiki_page') linked.set(target.id, target);
      relations.push({
        from: byId.get(edge.source)!.label,
        type: edge.type,
        to: target.label,
      });
    }
    return {
      pages,
      relations,
      linked: [...linked.values()].map((n) => ({
        kind: n.kind as WikiRelationTarget,
        ref: n.id.slice(n.id.indexOf(':') + 1),
        label: n.label,
      })),
    };
  }

  private async snapshot(memberId: string): Promise<Snapshot> {
    const spaces = await this.deps.wiki.readableSpaces(memberId);
    const snap: Snapshot = {
      memberId,
      spaces: new Map(
        spaces.map((s) => [s.department.id, { name: s.department.name, can: s.can }]),
      ),
      pages: new Map(),
      byTitle: new Map(),
      external: new Map(),
    };
    if (spaces.length === 0) return snap;
    const rows = await this.db
      .select({
        id: wikiPages.id,
        title: wikiPages.title,
        departmentId: wikiPages.departmentId,
        folderId: wikiPages.folderId,
      })
      .from(wikiPages)
      .where(
        and(
          inArray(
            wikiPages.departmentId,
            spaces.map((s) => s.department.id),
          ),
          isNull(wikiPages.archivedAt),
        ),
      )
      .orderBy(asc(wikiPages.id));
    for (const row of rows) {
      snap.pages.set(row.id, row);
      const key = row.title.trim().toLowerCase();
      snap.byTitle.set(key, [...(snap.byTitle.get(key) ?? []), row]);
    }
    return snap;
  }

  /** `[[Title]]` names the page of that title in the same space first, then anywhere. */
  private pageByTitle(snap: Snapshot, title: string, departmentId: string): PageInfo | undefined {
    const candidates = snap.byTitle.get(title.trim().toLowerCase()) ?? [];
    return candidates.find((p) => p.departmentId === departmentId) ?? candidates[0];
  }

  private pageNode(snap: Snapshot, page: PageInfo): WikiRelationNode {
    return {
      kind: 'wiki_page',
      ref: page.id,
      label: page.title,
      href: hrefOf('wiki_page', page.id),
      department: { id: page.departmentId, name: snap.spaces.get(page.departmentId)!.name },
    };
  }

  private external(
    snap: Snapshot,
    kind: WikiRelationTarget,
    ref: string,
  ): Promise<ExternalTarget | null> {
    const key = `${kind}:${ref}`;
    let found = snap.external.get(key);
    if (!found) {
      const targets = this.deps.targets;
      const lookup =
        kind === 'issue'
          ? targets.issue(snap.memberId, ref)
          : kind === 'request'
            ? targets.request(snap.memberId, ref)
            : targets.whiteboard(snap.memberId, ref);
      found = lookup.catch(() => null);
      snap.external.set(key, found);
    }
    return found;
  }

  /** A stored target by id or number, as the member may see it; null when hidden or gone. */
  private async node(
    snap: Snapshot,
    kind: WikiRelationTarget,
    ref: string,
  ): Promise<WikiRelationNode | null> {
    if (kind === 'wiki_page') {
      const page = snap.pages.get(ref);
      return page ? this.pageNode(snap, page) : null;
    }
    const found = await this.external(snap, kind, ref);
    return found
      ? { kind, ref: found.ref, label: found.label, href: hrefOf(kind, found.ref) }
      : null;
  }

  private async linkNode(
    snap: Snapshot,
    link: WikiLink,
    departmentId: string,
  ): Promise<WikiRelationNode | null> {
    if (link.byTitle) {
      const page = this.pageByTitle(snap, link.ref, departmentId);
      return page ? this.pageNode(snap, page) : null;
    }
    return this.node(snap, link.kind, link.ref);
  }

  /** What someone typed as a relation target: a page id or title, a number, a board id. */
  private async target(
    snap: Snapshot,
    kind: WikiRelationTarget,
    text: string,
    departmentId: string,
  ): Promise<WikiRelationNode | null> {
    const ref = text.trim();
    if (kind === 'wiki_page' && !UUID.test(ref)) {
      return this.linkNode(snap, { kind, ref, byTitle: true }, departmentId);
    }
    if (kind === 'whiteboard' && !UUID.test(ref)) return null;
    return this.node(snap, kind, kind === 'issue' || kind === 'request' ? ref.toUpperCase() : ref);
  }

  /** Readable pages whose text links to this page, by id or by `[[title]]`. */
  private async pagesLinkingTo(
    snap: Snapshot,
    page: { id: string; title: string },
  ): Promise<PageInfo[]> {
    if (snap.spaces.size === 0) return [];
    const candidates = await this.db
      .select({
        id: wikiPages.id,
        content: wikiPages.content,
        departmentId: wikiPages.departmentId,
      })
      .from(wikiPages)
      .where(
        and(
          inArray(wikiPages.departmentId, [...snap.spaces.keys()]),
          isNull(wikiPages.archivedAt),
          ne(wikiPages.id, page.id),
          or(
            ilike(wikiPages.content, `%/wiki/page/${page.id}%`),
            ilike(wikiPages.content, `%[[${likeText(page.title.trim())}%`),
          ),
        ),
      );
    // The same rules as outgoing links decide, so `[[Title]]` in another space with its own
    // page of that title does not count.
    const result: PageInfo[] = [];
    for (const candidate of candidates) {
      const source = snap.pages.get(candidate.id);
      if (!source) continue;
      for (const link of wikiLinks(candidate.content)) {
        if (link.kind !== 'wiki_page') continue;
        const target = link.byTitle
          ? this.pageByTitle(snap, link.ref, candidate.departmentId)
          : snap.pages.get(link.ref);
        if (target?.id === page.id) {
          result.push(source);
          break;
        }
      }
    }
    return result.sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Links written in the pages of these spaces, extracted by PostgreSQL. */
  private async linksIn(
    departmentIds: string[],
  ): Promise<Array<{ pageId: string; link: WikiLink }>> {
    const result = await this.db.execute(sql`
      select p.id as page_id, array_to_json(m.groups) as groups
      from ${wikiPages} p, lateral regexp_matches(p.content, ${WIKI_LINK_PATTERN}, 'g') as m(groups)
      where p.archived_at is null and p.department_id in (${sql.join(
        departmentIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`);
    // node-postgres and PGlite shape raw results differently.
    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Array<{
      page_id: string;
      groups: Array<string | null> | string;
    }>;
    const seen = new Set<string>();
    const links: Array<{ pageId: string; link: WikiLink }> = [];
    for (const row of rows) {
      const groups = typeof row.groups === 'string' ? JSON.parse(row.groups) : row.groups;
      const link = wikiLinkFromGroups(groups as Array<string | null>);
      const key = `${row.page_id}|${link.kind}|${link.byTitle ? 't' : ''}|${link.ref.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ pageId: row.page_id, link });
    }
    return links;
  }
}

function linkView(direction: 'in' | 'out', node: WikiRelationNode): WikiRelationView {
  return {
    id: null,
    type: 'references',
    direction,
    origin: 'link',
    node,
    note: null,
    canRemove: false,
  };
}
