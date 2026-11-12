import {
  WIKI_MAX_DEPTH,
  wikiFolderCreateSchema,
  wikiFolderUpdateSchema,
  wikiPageCreateSchema,
  wikiPageUpdateSchema,
  type AttachmentView,
  type MemberRef,
  type WikiFolder,
  type WikiFolderCreate,
  type WikiFolderUpdate,
  type WikiPageCreate,
  type WikiPageSummary,
  type WikiPageUpdate,
  type WikiPageView,
  type WikiRevision,
  type WikiRevisionView,
  type WikiSearchHit,
  type WikiSpace,
  type WikiTree,
  type WikiVisibility,
} from '@ordler/shared';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { storeAttachment, type UploadedFile } from '../attachments/attachment.service.js';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import { departments, members, wikiFolders, wikiPageRevisions, wikiPages } from '../db/schema.js';
import type { WikiAccess, WikiPermissions } from './wiki-access.js';

type DepartmentRow = typeof departments.$inferSelect;
type PageRow = typeof wikiPages.$inferSelect;
type FolderRow = typeof wikiFolders.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEARCH_LIMIT = 50;
const SNIPPET = 160;

export interface WikiServiceDeps {
  db: Db;
  access: WikiAccess;
  maxFileBytes: number;
  now?: () => Date;
}

/** Escapes LIKE wildcards so a search for "100%" means the text "100%". */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function snippet(content: string, query: string): string {
  const plain = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#>*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const at = plain.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, at < 0 ? 0 : at - SNIPPET / 3);
  const piece = plain.slice(start, start + SNIPPET);
  return `${start > 0 ? '…' : ''}${piece}${start + SNIPPET < plain.length ? '…' : ''}`;
}

/**
 * Department wikis (SPEC §5.6, ADR 0017). Reading needs `wiki.read` over the department (or an
 * organization-visible space), editing `wiki.edit`; deleting other people's pages, folders and
 * visibility need `department.update`. Every saved version is kept in `wiki_page_revisions`.
 */
export class WikiService {
  constructor(private readonly deps: WikiServiceDeps) {}

  private get db(): Db {
    return this.deps.db;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Spaces the member can read, one per active department. */
  async spaces(memberId: string): Promise<WikiSpace[]> {
    const rows = await this.db
      .select()
      .from(departments)
      .where(isNull(departments.archivedAt))
      .orderBy(asc(departments.name));
    const permissions = await this.deps.access.forDepartments(memberId, rows);
    const readable = rows.filter((d) => permissions.get(d.id)!.read);
    if (readable.length === 0) return [];
    const counts = await this.db
      .select({ departmentId: wikiPages.departmentId, pages: count() })
      .from(wikiPages)
      .where(
        and(
          inArray(
            wikiPages.departmentId,
            readable.map((d) => d.id),
          ),
          isNull(wikiPages.archivedAt),
        ),
      )
      .groupBy(wikiPages.departmentId);
    return readable.map((d) =>
      space(d, permissions.get(d.id)!, counts.find((c) => c.departmentId === d.id)?.pages ?? 0),
    );
  }

  async tree(memberId: string, departmentId: string): Promise<WikiTree> {
    const { department, can } = await this.readable(memberId, departmentId);
    const folders = await this.db
      .select()
      .from(wikiFolders)
      .where(eq(wikiFolders.departmentId, department.id))
      .orderBy(asc(wikiFolders.name));
    const pages = await this.pageSummaries(
      and(eq(wikiPages.departmentId, department.id), isNull(wikiPages.archivedAt))!,
    );
    return {
      space: space(department, can, pages.length),
      folders: folders.map(folderView),
      pages,
    };
  }

  async setVisibility(memberId: string, departmentId: string, visibility: WikiVisibility) {
    const { department, can } = await this.readable(memberId, departmentId);
    if (!can.manage) throw new DomainError('forbidden');
    await this.db
      .update(departments)
      .set({ wikiVisibility: visibility })
      .where(eq(departments.id, department.id));
    await this.audit(memberId, 'wiki.visibility_changed', 'department', department.id, {
      before: { visibility: department.wikiVisibility },
      after: { visibility },
    });
    return (await this.tree(memberId, departmentId)).space;
  }

  async createFolder(memberId: string, raw: WikiFolderCreate, via?: string): Promise<WikiFolder> {
    const input = wikiFolderCreateSchema.parse(raw);
    const { department, can } = await this.readable(memberId, input.department);
    if (!can.edit) throw new DomainError('forbidden');
    const parentId = input.parentId ?? null;
    if (parentId) {
      const depth = await this.depth(department.id, parentId);
      if (depth + 1 >= WIKI_MAX_DEPTH) throw new DomainError('wiki_too_deep');
    }
    const [row] = await this.db
      .insert(wikiFolders)
      .values({ departmentId: department.id, parentId, name: input.name, createdBy: memberId })
      .returning();
    await this.audit(memberId, 'wiki.folder_created', 'wiki_folder', row!.id, {
      after: { name: row!.name, departmentId: department.id, ...(via ? { via } : {}) },
    });
    return folderView(row!);
  }

  async updateFolder(memberId: string, id: string, raw: WikiFolderUpdate): Promise<WikiFolder> {
    const input = wikiFolderUpdateSchema.parse(raw);
    const folder = await this.folder(id);
    const { can } = await this.readable(memberId, folder.departmentId);
    if (!can.edit) throw new DomainError('forbidden');
    const patch: Partial<FolderRow> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.parentId !== undefined) {
      const parentId = input.parentId;
      if (parentId) {
        // A folder cannot move into itself or anything below it.
        const ancestors = await this.ancestors(folder.departmentId, parentId);
        if (parentId === folder.id || ancestors.some((a) => a.id === folder.id)) {
          throw new DomainError('validation_failed');
        }
        const height = await this.height(folder.departmentId, folder.id);
        if (ancestors.length + 1 + height >= WIKI_MAX_DEPTH) {
          throw new DomainError('wiki_too_deep');
        }
      }
      patch.parentId = parentId;
    }
    const [row] = await this.db
      .update(wikiFolders)
      .set(patch)
      .where(eq(wikiFolders.id, folder.id))
      .returning();
    await this.audit(memberId, 'wiki.folder_updated', 'wiki_folder', folder.id, {
      before: { name: folder.name, parentId: folder.parentId },
      after: patch,
    });
    return folderView(row!);
  }

  /** Only empty folders go; pages are deleted (archived) one by one, so nothing vanishes by surprise. */
  async deleteFolder(memberId: string, id: string): Promise<void> {
    const folder = await this.folder(id);
    const { can } = await this.readable(memberId, folder.departmentId);
    if (!can.edit) throw new DomainError('forbidden');
    const [children] = await this.db
      .select({ n: count() })
      .from(wikiFolders)
      .where(eq(wikiFolders.parentId, folder.id));
    const [pages] = await this.db
      .select({ n: count() })
      .from(wikiPages)
      .where(and(eq(wikiPages.folderId, folder.id), isNull(wikiPages.archivedAt)));
    if (children!.n > 0 || pages!.n > 0) throw new DomainError('wiki_folder_not_empty');
    await this.db.transaction(async (tx) => {
      // Deleted pages keep their history; they just no longer point at the folder.
      await tx.update(wikiPages).set({ folderId: null }).where(eq(wikiPages.folderId, folder.id));
      await tx.delete(wikiFolders).where(eq(wikiFolders.id, folder.id));
    });
    await this.audit(memberId, 'wiki.folder_deleted', 'wiki_folder', folder.id, {
      before: { name: folder.name, departmentId: folder.departmentId },
    });
  }

  async createPage(memberId: string, raw: WikiPageCreate, via?: string): Promise<WikiPageView> {
    const input = wikiPageCreateSchema.parse(raw);
    const { department, can } = await this.readable(memberId, input.department);
    if (!can.edit) throw new DomainError('forbidden');
    const folderId = input.folderId ?? null;
    if (folderId) await this.folderIn(department.id, folderId);
    const id = await this.insertPage({
      departmentId: department.id,
      folderId,
      title: input.title,
      content: input.content,
      authorId: memberId,
    });
    await this.audit(memberId, 'wiki.page_created', 'wiki_page', id, {
      after: { title: input.title, departmentId: department.id, ...(via ? { via } : {}) },
    });
    return this.page(memberId, id);
  }

  /** Writes a page and its first revision without permission checks (callers check). */
  async insertPage(input: {
    departmentId: string;
    folderId: string | null;
    title: string;
    content: string;
    authorId: string | null;
    createdAt?: Date;
    updatedAt?: Date;
  }): Promise<string> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(wikiPages)
        .values({
          departmentId: input.departmentId,
          folderId: input.folderId,
          title: input.title,
          content: input.content,
          createdBy: input.authorId,
          updatedBy: input.authorId,
          ...(input.createdAt ? { createdAt: input.createdAt } : {}),
          updatedAt: input.updatedAt ?? this.now(),
        })
        .returning();
      await tx.insert(wikiPageRevisions).values({
        pageId: row!.id,
        version: 1,
        title: row!.title,
        content: row!.content,
        authorId: input.authorId,
        createdAt: input.updatedAt ?? this.now(),
      });
      return row!.id;
    });
  }

  async page(memberId: string, id: string): Promise<WikiPageView> {
    const row = await this.pageRow(id);
    const { department, can } = await this.readable(memberId, row.departmentId);
    const [summary] = await this.pageSummaries(eq(wikiPages.id, row.id));
    const [creator] = row.createdBy
      ? await this.db
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(eq(members.id, row.createdBy))
      : [];
    return {
      ...summary!,
      department: { id: department.id, name: department.name },
      path: row.folderId ? await this.ancestorsAndSelf(department.id, row.folderId) : [],
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      createdBy: creator ?? null,
      canEdit: can.edit,
      canManage: can.manage || (can.edit && row.createdBy === memberId),
    };
  }

  async updatePage(
    memberId: string,
    id: string,
    raw: WikiPageUpdate,
    via?: string,
  ): Promise<WikiPageView> {
    const input = wikiPageUpdateSchema.parse(raw);
    const current = await this.pageRow(id);
    const { can } = await this.readable(memberId, current.departmentId);
    if (!can.edit) throw new DomainError('forbidden');
    if (input.folderId) await this.folderIn(current.departmentId, input.folderId);
    await this.savePage(current.id, memberId, input);
    const textChanged = input.title !== undefined || input.content !== undefined;
    // People's edits are in the page history; agents' edits are also audited, to see who acted.
    if (via !== undefined || (!textChanged && input.folderId !== undefined)) {
      await this.audit(memberId, 'wiki.page_updated', 'wiki_page', current.id, {
        before: { title: current.title, folderId: current.folderId },
        after: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
          ...(via !== undefined ? { via } : {}),
        },
      });
    }
    return this.page(memberId, current.id);
  }

  /** Applies an edit under the row lock; a stale `baseVersion` is a conflict. No permission checks. */
  async savePage(
    id: string,
    authorId: string | null,
    input: { title?: string; content?: string; folderId?: string | null; baseVersion?: number },
    at?: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(wikiPages).where(eq(wikiPages.id, id)).for('update');
      if (!row || row.archivedAt) throw new DomainError('not_found');
      if (input.baseVersion !== undefined && input.baseVersion !== row.version) {
        throw new DomainError('wiki_conflict');
      }
      const title = input.title ?? row.title;
      const content = input.content ?? row.content;
      const textChanged = title !== row.title || content !== row.content;
      const version = textChanged ? row.version + 1 : row.version;
      await tx
        .update(wikiPages)
        .set({
          title,
          content,
          version,
          ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
          ...(textChanged ? { updatedBy: authorId, updatedAt: at ?? this.now() } : {}),
        })
        .where(eq(wikiPages.id, id));
      if (textChanged) {
        await tx.insert(wikiPageRevisions).values({
          pageId: id,
          version,
          title,
          content,
          authorId,
          createdAt: at ?? this.now(),
        });
      }
    });
  }

  /** Deleting archives the page: it disappears from the space but its history stays. */
  async archivePage(memberId: string, id: string, via?: string): Promise<void> {
    const row = await this.pageRow(id);
    const { can } = await this.readable(memberId, row.departmentId);
    if (!(can.manage || (can.edit && row.createdBy === memberId))) {
      throw new DomainError('forbidden');
    }
    await this.db.update(wikiPages).set({ archivedAt: this.now() }).where(eq(wikiPages.id, row.id));
    await this.audit(memberId, 'wiki.page_deleted', 'wiki_page', row.id, {
      before: { title: row.title, departmentId: row.departmentId },
      ...(via ? { after: { via } } : {}),
    });
  }

  async revisions(memberId: string, id: string): Promise<WikiRevision[]> {
    const row = await this.pageRow(id);
    await this.readable(memberId, row.departmentId);
    const rows = await this.db
      .select({
        version: wikiPageRevisions.version,
        title: wikiPageRevisions.title,
        createdAt: wikiPageRevisions.createdAt,
        authorId: members.id,
        authorName: members.name,
      })
      .from(wikiPageRevisions)
      .leftJoin(members, eq(members.id, wikiPageRevisions.authorId))
      .where(eq(wikiPageRevisions.pageId, row.id))
      .orderBy(desc(wikiPageRevisions.version));
    return rows.map((r) => ({
      version: r.version,
      title: r.title,
      author: r.authorId ? { id: r.authorId, name: r.authorName! } : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async revision(memberId: string, id: string, version: number): Promise<WikiRevisionView> {
    const row = await this.pageRow(id);
    await this.readable(memberId, row.departmentId);
    const [r] = await this.db
      .select({ revision: wikiPageRevisions, authorName: members.name })
      .from(wikiPageRevisions)
      .leftJoin(members, eq(members.id, wikiPageRevisions.authorId))
      .where(and(eq(wikiPageRevisions.pageId, row.id), eq(wikiPageRevisions.version, version)));
    if (!r) throw new DomainError('not_found');
    return {
      version: r.revision.version,
      title: r.revision.title,
      content: r.revision.content,
      author: r.revision.authorId ? { id: r.revision.authorId, name: r.authorName! } : null,
      createdAt: r.revision.createdAt.toISOString(),
    };
  }

  /** Pages whose title or text contains the query, in every readable space (or one). */
  async search(memberId: string, query: string, departmentId?: string): Promise<WikiSearchHit[]> {
    const text = query.trim().slice(0, 200);
    if (text.length < 2) return [];
    const spaces = departmentId
      ? [(await this.readable(memberId, departmentId)).department]
      : await this.readableDepartments(memberId);
    if (spaces.length === 0) return [];
    const pattern = likePattern(text);
    const rows = await this.db
      .select({
        id: wikiPages.id,
        title: wikiPages.title,
        content: wikiPages.content,
        departmentId: wikiPages.departmentId,
        updatedAt: wikiPages.updatedAt,
        inTitle: sql<boolean>`${wikiPages.title} ilike ${pattern}`,
      })
      .from(wikiPages)
      .where(
        and(
          inArray(
            wikiPages.departmentId,
            spaces.map((d) => d.id),
          ),
          isNull(wikiPages.archivedAt),
          or(ilike(wikiPages.title, pattern), ilike(wikiPages.content, pattern)),
        ),
      )
      .orderBy(desc(sql`${wikiPages.title} ilike ${pattern}`), desc(wikiPages.updatedAt))
      .limit(SEARCH_LIMIT);
    return rows.map((r) => {
      const d = spaces.find((s) => s.id === r.departmentId)!;
      return {
        id: r.id,
        title: r.title,
        department: { id: d.id, name: d.name },
        snippet: snippet(r.content, text),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  /**
   * The folder at a path like `Guides/Setup`, for agents that think in paths. Missing folders
   * are created when `create` is set (and the member may edit); otherwise they are an error.
   */
  async folderAtPath(
    memberId: string,
    departmentId: string,
    path: string,
    create: boolean,
    via?: string,
  ): Promise<string | null> {
    const names = path
      .split('/')
      .map((n) => n.trim())
      .filter(Boolean);
    if (names.length === 0) return null;
    if (names.length > WIKI_MAX_DEPTH) throw new DomainError('wiki_too_deep');
    const { department } = await this.readable(memberId, departmentId);
    const folders = await this.foldersOf(department.id);
    let parent: string | null = null;
    for (const name of names) {
      const found = folders.find(
        (f) => f.parentId === parent && f.name.toLowerCase() === name.toLowerCase(),
      );
      if (found) {
        parent = found.id;
        continue;
      }
      if (!create) throw new DomainError('not_found');
      parent = (
        await this.createFolder(
          memberId,
          { department: department.id, parentId: parent, name },
          via,
        )
      ).id;
    }
    return parent;
  }

  /** Images and files pasted into wiki pages belong to the department. */
  async upload(
    memberId: string,
    departmentId: string,
    file: UploadedFile,
  ): Promise<AttachmentView> {
    const { department, can } = await this.readable(memberId, departmentId);
    if (!can.edit) throw new DomainError('forbidden');
    if (file.data.length === 0) throw new DomainError('file_missing');
    if (file.data.length > this.deps.maxFileBytes) throw new DomainError('file_too_large');
    return storeAttachment(this.db, { departmentId: department.id, uploadedBy: memberId, file });
  }

  /** Whether a member may read a department's wiki: decides access to its files. */
  async canRead(memberId: string, departmentId: string): Promise<boolean> {
    const [department] = await this.db
      .select()
      .from(departments)
      .where(eq(departments.id, departmentId));
    if (!department) return false;
    return (await this.deps.access.forDepartment(memberId, department)).read;
  }

  /** The space after permission checks; unreadable looks missing. */
  async readable(
    memberId: string,
    departmentId: string,
  ): Promise<{ department: DepartmentRow; can: WikiPermissions }> {
    if (!UUID.test(departmentId)) throw new DomainError('not_found');
    const [department] = await this.db
      .select()
      .from(departments)
      .where(eq(departments.id, departmentId));
    if (!department || department.archivedAt) throw new DomainError('not_found');
    const can = await this.deps.access.forDepartment(memberId, department);
    if (!can.read) throw new DomainError('not_found');
    return { department, can };
  }

  private async readableDepartments(memberId: string): Promise<DepartmentRow[]> {
    const rows = await this.db.select().from(departments).where(isNull(departments.archivedAt));
    const permissions = await this.deps.access.forDepartments(memberId, rows);
    return rows.filter((d) => permissions.get(d.id)!.read);
  }

  async pageRow(id: string): Promise<PageRow> {
    if (!UUID.test(id)) throw new DomainError('not_found');
    const [row] = await this.db.select().from(wikiPages).where(eq(wikiPages.id, id));
    if (!row || row.archivedAt) throw new DomainError('not_found');
    return row;
  }

  private async folder(id: string): Promise<FolderRow> {
    if (!UUID.test(id)) throw new DomainError('not_found');
    const [row] = await this.db.select().from(wikiFolders).where(eq(wikiFolders.id, id));
    if (!row) throw new DomainError('not_found');
    return row;
  }

  /** A folder of this department; anything else is a bad reference, not a leak. */
  async folderIn(departmentId: string, folderId: string): Promise<FolderRow> {
    const folder = await this.folder(folderId).catch(() => undefined);
    if (!folder || folder.departmentId !== departmentId) {
      throw new DomainError('validation_failed');
    }
    return folder;
  }

  private async foldersOf(departmentId: string): Promise<FolderRow[]> {
    return this.db.select().from(wikiFolders).where(eq(wikiFolders.departmentId, departmentId));
  }

  /** The folder's ancestors from the root, the folder itself excluded. */
  private async ancestors(departmentId: string, folderId: string): Promise<FolderRow[]> {
    const chain = await this.ancestorsAndSelfRows(departmentId, folderId);
    return chain.slice(0, -1);
  }

  private async ancestorsAndSelfRows(departmentId: string, folderId: string) {
    const all = new Map((await this.foldersOf(departmentId)).map((f) => [f.id, f]));
    const chain: FolderRow[] = [];
    let current = all.get(folderId);
    while (current && chain.length <= WIKI_MAX_DEPTH * 2) {
      chain.unshift(current);
      current = current.parentId ? all.get(current.parentId) : undefined;
    }
    return chain;
  }

  private async ancestorsAndSelf(departmentId: string, folderId: string): Promise<WikiFolder[]> {
    return (await this.ancestorsAndSelfRows(departmentId, folderId)).map(folderView);
  }

  /** Levels from the root to the folder: a root folder has depth 0. */
  private async depth(departmentId: string, folderId: string): Promise<number> {
    await this.folderIn(departmentId, folderId);
    return (await this.ancestorsAndSelfRows(departmentId, folderId)).length - 1;
  }

  /** Levels of subfolders below a folder: a leaf has height 0. */
  private async height(departmentId: string, folderId: string): Promise<number> {
    const all = await this.foldersOf(departmentId);
    const below = (id: string, guard: number): number => {
      if (guard > WIKI_MAX_DEPTH * 2) return guard;
      const children = all.filter((f) => f.parentId === id);
      return children.length === 0
        ? 0
        : 1 + Math.max(...children.map((c) => below(c.id, guard + 1)));
    };
    return below(folderId, 0);
  }

  private async pageSummaries(where: ReturnType<typeof eq>): Promise<WikiPageSummary[]> {
    const rows = await this.db
      .select({ page: wikiPages, updaterName: members.name })
      .from(wikiPages)
      .leftJoin(members, eq(members.id, wikiPages.updatedBy))
      .where(where)
      .orderBy(asc(wikiPages.title));
    return rows.map(({ page, updaterName }) => ({
      id: page.id,
      departmentId: page.departmentId,
      folderId: page.folderId,
      title: page.title,
      version: page.version,
      updatedAt: page.updatedAt.toISOString(),
      updatedBy: page.updatedBy ? ({ id: page.updatedBy, name: updaterName! } as MemberRef) : null,
    }));
  }

  private audit(
    memberId: string,
    action: string,
    targetType: string,
    targetId: string,
    change: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ) {
    return writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action,
      targetType,
      targetId,
      ...change,
    });
  }
}

function space(department: DepartmentRow, can: WikiPermissions, pages: number): WikiSpace {
  return {
    department: { id: department.id, name: department.name },
    visibility: department.wikiVisibility,
    pages,
    canEdit: can.edit,
    canManage: can.manage,
  };
}

function folderView(row: FolderRow): WikiFolder {
  return { id: row.id, parentId: row.parentId, name: row.name };
}
