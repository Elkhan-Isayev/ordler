import {
  WIKI_MAX_DEPTH,
  wikiImportConnectSchema,
  wikiImportStartSchema,
  wikiPathSelected,
  type WikiImportConnect,
  type WikiImportCounts,
  type WikiImportSourcePage,
  type WikiImportStart,
  type WikiImportView,
} from '@ordler/shared';
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { storeAttachment } from '../attachments/attachment.service.js';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { SecretBox } from '../crypto/secret-box.js';
import type { Db } from '../db/client.js';
import { departments, externalRefs, wikiFolders, wikiImports, wikiPages } from '../db/schema.js';
import { nodeFetch, SourceError, type HttpFetch } from '../imports/sources/types.js';
import { htmlToMarkdown } from './html-markdown.js';
import type { WikiService } from './wiki.service.js';
import { localReferences, pagePathOf, rewriteTargets, WikiJsSource } from './wikijs-source.js';

type Run = typeof wikiImports.$inferSelect;
/** What `page_ids` holds: the pages chosen at start, in path order. */
type Planned = Pick<WikiImportSourcePage, 'id' | 'path' | 'locale'>;

const BATCH = 10;
const MAX_FAILURES = 5;
const REPORT_LIMIT = 500;
const ZERO: WikiImportCounts = { imported: 0, updated: 0, skipped: 0, failed: 0, files: 0 };

const tokenPurpose = (id: string) => `wiki-import:${id}`;
const sourceKey = (run: Pick<Run, 'baseUrl'>) => `wikijs:${run.baseUrl}`;

export interface WikiImportDeps {
  db: Db;
  box: SecretBox;
  wiki: WikiService;
  maxFileBytes: number;
  fetch?: HttpFetch;
  now?: () => Date;
  leaseMs?: number;
}

/**
 * Import from Wiki.js (ADR 0017): pages and whole folders by API key into a department's wiki,
 * keeping the folder tree, copying images and files, and pointing links between imported pages
 * at their Ordler copies. Runs in the background like issue imports, resumable and re-runnable.
 * Department managers only (`department.update`).
 */
export class WikiImportService {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(private readonly deps: WikiImportDeps) {}

  private get db(): Db {
    return this.deps.db;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private source(baseUrl: string, token: string): WikiJsSource {
    return new WikiJsSource(baseUrl, token, this.deps.fetch ?? nodeFetch);
  }

  async list(memberId: string, departmentId: string): Promise<WikiImportView[]> {
    await this.manageable(memberId, departmentId);
    const rows = await this.db
      .select()
      .from(wikiImports)
      .where(eq(wikiImports.departmentId, departmentId))
      .orderBy(desc(wikiImports.createdAt));
    return Promise.all(rows.map((row) => this.view(row)));
  }

  /** Checks the key by listing pages, then keeps it sealed for this import only. */
  async connect(memberId: string, raw: WikiImportConnect): Promise<WikiImportView> {
    const input = wikiImportConnectSchema.parse(raw);
    await this.manageable(memberId, input.department);
    if (input.folderId) await this.deps.wiki.folderIn(input.department, input.folderId);
    const baseUrl = new URL(input.baseUrl).origin;
    await call(() => this.source(baseUrl, input.token).pages());
    const [row] = await this.db
      .insert(wikiImports)
      .values({
        departmentId: input.department,
        folderId: input.folderId ?? null,
        baseUrl,
        createdBy: memberId,
      })
      .returning();
    await this.db
      .update(wikiImports)
      .set({ tokenEncrypted: this.deps.box.encrypt(input.token, tokenPurpose(row!.id)) })
      .where(eq(wikiImports.id, row!.id));
    await this.audit(memberId, 'wiki.import_connected', row!.id, { baseUrl });
    return this.get(memberId, row!.id);
  }

  async get(memberId: string, id: string): Promise<WikiImportView> {
    const row = await this.row(id);
    await this.manageable(memberId, row.departmentId);
    return this.view(row);
  }

  /** What the key can see, for choosing pages and folders. */
  async pages(memberId: string, id: string): Promise<WikiImportSourcePage[]> {
    const run = await this.row(id);
    await this.manageable(memberId, run.departmentId);
    return call(() => this.sourceOf(run).pages());
  }

  async start(memberId: string, id: string, raw: WikiImportStart): Promise<WikiImportView> {
    const input = wikiImportStartSchema.parse(raw);
    const run = await this.row(id);
    await this.manageable(memberId, run.departmentId);
    if (run.status !== 'draft') throw new DomainError('import_not_ready');
    const all = await call(() => this.sourceOf(run).pages());
    const chosen = all.filter(
      (p) => input.pageIds.includes(p.id) || wikiPathSelected(p.path, input.paths),
    );
    if (chosen.length === 0) throw new DomainError('validation_failed');
    const planned: Planned[] = chosen.map(({ id: pageId, path, locale }) => ({
      id: pageId,
      path,
      locale,
    }));
    await this.db
      .update(wikiImports)
      .set({ status: 'running', pageIds: planned, cursor: 0 })
      .where(and(eq(wikiImports.id, run.id), eq(wikiImports.status, 'draft')));
    await this.audit(memberId, 'wiki.import_started', run.id, { pages: planned.length });
    return this.get(memberId, run.id);
  }

  /** Stops the import and erases the key; what was imported stays. */
  async cancel(memberId: string, id: string): Promise<WikiImportView> {
    const run = await this.row(id);
    await this.manageable(memberId, run.departmentId);
    if (run.status !== 'draft' && run.status !== 'running') {
      throw new DomainError('import_not_ready');
    }
    await this.db
      .update(wikiImports)
      .set({ status: 'canceled', tokenEncrypted: null, finishedAt: this.now(), leaseUntil: null })
      .where(eq(wikiImports.id, run.id));
    await this.audit(memberId, 'wiki.import_canceled', run.id, {});
    return this.get(memberId, run.id);
  }

  startRunner(intervalMs = 15_000, log?: (message: string) => void): void {
    const loop = async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        while (await this.tick()) {
          /* keep going while pages remain */
        }
      } catch (error) {
        log?.(`Wiki import runner failed: ${String(error)}`);
      } finally {
        this.busy = false;
      }
    };
    void loop();
    this.timer = setInterval(() => void loop(), intervalMs);
    this.timer.unref();
  }

  stopRunner(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<boolean> {
    const running = await this.db
      .select({ id: wikiImports.id })
      .from(wikiImports)
      .where(eq(wikiImports.status, 'running'));
    let worked = false;
    for (const run of running) worked = (await this.step(run.id)) || worked;
    return worked;
  }

  /** Tests and small imports: steps until the import stops running. */
  async runToCompletion(id: string, maxSteps = 1000): Promise<void> {
    for (let i = 0; i < maxSteps; i++) {
      if (!(await this.step(id))) break;
    }
  }

  /** Claims the import with a lease, imports a batch of pages and saves where it got to. */
  async step(id: string): Promise<boolean> {
    const now = this.now();
    const [run] = await this.db
      .update(wikiImports)
      .set({ leaseUntil: new Date(now.getTime() + (this.deps.leaseMs ?? 10 * 60_000)) })
      .where(
        and(
          eq(wikiImports.id, id),
          eq(wikiImports.status, 'running'),
          or(isNull(wikiImports.leaseUntil), lt(wikiImports.leaseUntil, now)),
        ),
      )
      .returning();
    if (!run) return false;
    const planned = run.pageIds as Planned[];
    const counts: WikiImportCounts = { ...ZERO, ...(run.counts as Partial<WikiImportCounts>) };
    const report = run.report as WikiImportView['report'];
    let cursor = run.cursor;
    try {
      const source = this.sourceOf(run);
      const folders = new FolderCache(this.db, run.departmentId, run.folderId, run.createdBy);
      const end = Math.min(planned.length, cursor + BATCH);
      for (; cursor < end; cursor++) {
        const item = planned[cursor]!;
        try {
          await this.importPage(run, source, folders, item, counts);
        } catch (error) {
          if (error instanceof SourceError && error.code === 'import_auth_failed') throw error;
          counts.failed++;
          if (report.length < REPORT_LIMIT) {
            report.push({
              path: item.path,
              reason: String((error as Error).message).slice(0, 300),
            });
          }
        }
      }
      const done = cursor >= planned.length;
      if (done) await this.linkPages(run, planned);
      await this.db
        .update(wikiImports)
        .set({
          cursor,
          counts,
          report,
          leaseUntil: null,
          ...(done
            ? { status: 'completed' as const, tokenEncrypted: null, finishedAt: this.now() }
            : {}),
        })
        // A cancel during the batch wins: the import stays canceled.
        .where(and(eq(wikiImports.id, run.id), eq(wikiImports.status, 'running')));
      if (done) await this.audit(run.createdBy, 'wiki.import_completed', run.id, counts);
      return !done;
    } catch (error) {
      const auth = error instanceof SourceError && error.code === 'import_auth_failed';
      const failures = (counts as { failures?: number }).failures ?? 0;
      await this.db
        .update(wikiImports)
        .set({
          cursor,
          counts: { ...counts, failures: failures + 1 },
          report,
          leaseUntil:
            auth || failures + 1 >= MAX_FAILURES ? null : new Date(now.getTime() + 30_000),
          ...(auth || failures + 1 >= MAX_FAILURES
            ? {
                status: 'failed' as const,
                tokenEncrypted: null,
                error: auth ? 'import_auth_failed' : String((error as Error).message).slice(0, 500),
                finishedAt: this.now(),
              }
            : {}),
        })
        .where(and(eq(wikiImports.id, run.id), eq(wikiImports.status, 'running')));
      return false;
    }
  }

  private async importPage(
    run: Run,
    source: WikiJsSource,
    folders: FolderCache,
    item: Planned,
    counts: WikiImportCounts,
  ): Promise<void> {
    const key = sourceKey(run);
    const externalId = String(item.id);
    const [ref] = await this.db
      .select()
      .from(externalRefs)
      .where(
        and(
          eq(externalRefs.sourceKey, key),
          eq(externalRefs.kind, 'wiki_page'),
          eq(externalRefs.externalId, externalId),
        ),
      );
    const page = await source.page(item.id);
    const updatedAt = new Date(page.updatedAt);
    if (ref?.sourceUpdatedAt && ref.sourceUpdatedAt >= updatedAt) {
      counts.skipped++;
      return;
    }
    let content = page.contentType === 'markdown' ? page.content : htmlToMarkdown(page.content);
    content = await this.copyFiles(run, source, content, counts);
    const title = (page.title || item.path.split('/').pop() || item.path).slice(0, 200);

    if (ref) {
      const [existing] = await this.db
        .select({ archivedAt: wikiPages.archivedAt })
        .from(wikiPages)
        .where(eq(wikiPages.id, ref.ordlerId));
      if (!existing || existing.archivedAt) {
        // Deleted in Ordler on purpose: a re-run must not bring it back.
        counts.skipped++;
        return;
      }
      await this.deps.wiki.savePage(ref.ordlerId, run.createdBy, { title, content }, updatedAt);
      await this.db
        .update(externalRefs)
        .set({ sourceUpdatedAt: updatedAt })
        .where(
          and(
            eq(externalRefs.sourceKey, key),
            eq(externalRefs.kind, 'wiki_page'),
            eq(externalRefs.externalId, externalId),
          ),
        );
      counts.updated++;
      return;
    }
    const segments = item.path.split('/').filter(Boolean);
    const folderId = await folders.ensure(segments.slice(0, -1));
    const id = await this.deps.wiki.insertPage({
      departmentId: run.departmentId,
      folderId,
      title,
      content,
      authorId: run.createdBy,
      createdAt: new Date(page.createdAt),
      updatedAt,
    });
    await this.db.insert(externalRefs).values({
      sourceKey: key,
      kind: 'wiki_page',
      externalId,
      ordlerId: id,
      sourceUpdatedAt: updatedAt,
    });
    counts.imported++;
  }

  /** Copies images and files the page links to, once per import source, and relinks them. */
  private async copyFiles(
    run: Run,
    source: WikiJsSource,
    content: string,
    counts: WikiImportCounts,
  ): Promise<string> {
    const files = new Map<string, string>();
    for (const reference of localReferences(content)) {
      if (!reference.isFile) continue;
      const path = reference.target.split(/[?#]/)[0]!;
      const externalId = `file:${path}`;
      const [ref] = await this.db
        .select()
        .from(externalRefs)
        .where(
          and(
            eq(externalRefs.sourceKey, sourceKey(run)),
            eq(externalRefs.kind, 'attachment'),
            eq(externalRefs.externalId, externalId),
          ),
        );
      if (ref) {
        files.set(
          reference.target,
          `/api/attachments/${ref.ordlerId}/${encodeURIComponent(fileName(path))}`,
        );
        continue;
      }
      const download = await source.download(path).catch((error: unknown) => {
        if (error instanceof SourceError && error.code === 'import_auth_failed') throw error;
        return undefined;
      });
      if (!download || download.data.length === 0) continue;
      if (download.data.length > this.deps.maxFileBytes) continue;
      const stored = await storeAttachment(this.db, {
        departmentId: run.departmentId,
        uploadedBy: run.createdBy,
        file: { filename: fileName(path), mimetype: download.contentType, data: download.data },
      });
      await this.db.insert(externalRefs).values({
        sourceKey: sourceKey(run),
        kind: 'attachment',
        externalId,
        ordlerId: stored.id,
      });
      counts.files++;
      files.set(reference.target, stored.url);
    }
    return files.size === 0 ? content : rewriteTargets(content, (target) => files.get(target));
  }

  /** Last pass: links to other imported pages open their Ordler copies. */
  private async linkPages(run: Run, planned: Planned[]): Promise<void> {
    const refs = await this.db
      .select({ externalId: externalRefs.externalId, ordlerId: externalRefs.ordlerId })
      .from(externalRefs)
      .where(and(eq(externalRefs.sourceKey, sourceKey(run)), eq(externalRefs.kind, 'wiki_page')));
    const byExternal = new Map(refs.map((r) => [r.externalId, r.ordlerId]));
    const byPath = new Map<string, string>();
    for (const p of planned) {
      const ordlerId = byExternal.get(String(p.id));
      if (ordlerId) byPath.set(p.path, ordlerId);
    }
    const locales = new Set(planned.map((p) => p.locale));
    const resolve = (target: string): string | undefined => {
      if (localReferences(`[x](${target})`)[0]?.isFile) return undefined;
      let path: string;
      try {
        path = pagePathOf(target, locales);
      } catch {
        return undefined;
      }
      const ordlerId = byPath.get(path);
      if (!ordlerId) return undefined;
      const anchor = target.includes('#') ? target.slice(target.indexOf('#')) : '';
      return `/wiki/page/${ordlerId}${anchor}`;
    };
    for (const ordlerId of new Set(byPath.values())) {
      const [page] = await this.db.select().from(wikiPages).where(eq(wikiPages.id, ordlerId));
      if (!page || page.archivedAt) continue;
      const content = rewriteTargets(page.content, resolve);
      if (content !== page.content) {
        // Relinking is part of importing the same version, so no new revision is written.
        await this.db.update(wikiPages).set({ content }).where(eq(wikiPages.id, page.id));
      }
    }
  }

  private sourceOf(run: Run): WikiJsSource {
    const token = run.tokenEncrypted
      ? this.deps.box.decrypt(run.tokenEncrypted, tokenPurpose(run.id))
      : undefined;
    if (!token) throw new DomainError('import_not_ready');
    return this.source(run.baseUrl, token);
  }

  private async manageable(memberId: string, departmentId: string): Promise<void> {
    const { can } = await this.deps.wiki.readable(memberId, departmentId);
    if (!can.manage) throw new DomainError('forbidden');
  }

  private async row(id: string): Promise<Run> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [row] = await this.db.select().from(wikiImports).where(eq(wikiImports.id, id));
    if (!row) throw new DomainError('not_found');
    return row;
  }

  /** Never includes the key. */
  private async view(row: Run): Promise<WikiImportView> {
    const [department] = await this.db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(eq(departments.id, row.departmentId));
    const counts = { ...ZERO, ...(row.counts as Partial<WikiImportCounts>) };
    return {
      id: row.id,
      department: department!,
      folderId: row.folderId,
      baseUrl: row.baseUrl,
      status: row.status,
      total: (row.pageIds as Planned[]).length,
      counts: {
        imported: counts.imported,
        updated: counts.updated,
        skipped: counts.skipped,
        failed: counts.failed,
        files: counts.files,
      },
      report: row.report as WikiImportView['report'],
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }

  private async audit(memberId: string | null, action: string, id: string, after: object) {
    await writeAudit(this.db, {
      actor: memberId ? { type: 'member', id: memberId } : { type: 'system' },
      action,
      targetType: 'wiki_import',
      targetId: id,
      after: after as Record<string, unknown>,
    });
  }
}

/** Finds or creates the folders of a Wiki.js path below the import's target folder. */
class FolderCache {
  private readonly known = new Map<string, string>();

  constructor(
    private readonly db: Db,
    private readonly departmentId: string,
    private readonly root: string | null,
    private readonly createdBy: string | null,
  ) {}

  async ensure(segments: string[]): Promise<string | null> {
    let parent = this.root;
    let depth = this.root ? await this.depthOf(this.root) : -1;
    for (const name of segments) {
      // Deeper paths than the wiki allows land in the deepest folder that fits.
      if (depth + 1 >= WIKI_MAX_DEPTH) break;
      const cacheKey = `${parent ?? ''}/${name}`;
      let id = this.known.get(cacheKey);
      if (!id) {
        const [existing] = await this.db
          .select({ id: wikiFolders.id })
          .from(wikiFolders)
          .where(
            and(
              eq(wikiFolders.departmentId, this.departmentId),
              parent ? eq(wikiFolders.parentId, parent) : isNull(wikiFolders.parentId),
              eq(wikiFolders.name, name),
            ),
          );
        id =
          existing?.id ??
          (
            await this.db
              .insert(wikiFolders)
              .values({
                departmentId: this.departmentId,
                parentId: parent,
                name,
                createdBy: this.createdBy,
              })
              .returning({ id: wikiFolders.id })
          )[0]!.id;
        this.known.set(cacheKey, id);
      }
      parent = id;
      depth++;
    }
    return parent;
  }

  private async depthOf(folderId: string): Promise<number> {
    let depth = -1;
    let current: string | null = folderId;
    while (current && depth < WIKI_MAX_DEPTH * 2) {
      const [row] = await this.db
        .select({ parentId: wikiFolders.parentId })
        .from(wikiFolders)
        .where(eq(wikiFolders.id, current));
      current = row?.parentId ?? null;
      depth++;
    }
    return depth;
  }
}

function fileName(path: string): string {
  const last = path.split('/').pop() ?? 'file';
  try {
    return decodeURIComponent(last) || 'file';
  } catch {
    return last || 'file';
  }
}

async function call<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof SourceError) throw new DomainError(error.code);
    throw error;
  }
}
