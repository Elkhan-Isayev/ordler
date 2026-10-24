import { randomUUID } from 'node:crypto';
import {
  attachmentUrl,
  type ImportConnectInput,
  type ImportConfigData,
  type ImportCounts,
  type ImportDryRun,
  type ImportOptions,
  type ImportReportItem,
  type ImportRunView,
  type ImportSource,
  type WorkflowStatus,
} from '@ordler/shared';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { storeAttachment } from '../attachments/attachment.service.js';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { SecretBox } from '../crypto/secret-box.js';
import type { Db } from '../db/client.js';
import {
  attachments,
  comments,
  externalRefs,
  importRuns,
  issueAssignees,
  issueEvents,
  issueLabels,
  issues,
  labels,
  members,
  teamMemberships,
  teams,
} from '../db/schema.js';
import { teamStatuses } from '../issues/workflows.js';
import type { OrgService } from '../org/org.service.js';
import type { EventBus } from '../realtime/event-bus.js';
import { ATTACHMENT_REF } from './markdown.js';
import type { SourceFactory } from './sources/index.js';
import {
  SourceError,
  type ExternalIssue,
  type ExternalPerson,
  type ImportSourceAdapter,
} from './sources/types.js';

type Run = typeof importRuns.$inferSelect;

interface Cursor {
  /** Index into `config.containers` being imported. */
  index: number;
  page: string | null;
  /** Source container → Ordler team, fixed when the run starts. */
  teams: Record<string, string>;
  /** Sub-issues whose parent was not imported yet; linked once every page is done. */
  pending: Array<{ issueId: string; parent: string }>;
  failures: number;
  waitUntil?: string;
}

interface TeamContext {
  id: string;
  key: string;
  statuses: WorkflowStatus[];
  labels: Map<string, string>;
  members: Set<string>;
}

const ZERO: ImportCounts = {
  imported: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  comments: 0,
  attachments: 0,
};
const REPORT_LIMIT = 1000;
const MAX_FAILURES = 5;
const DRY_RUN_PAGES = 20;
const SOURCE_NAME: Record<ImportSource, string> = { linear: 'Linear', jira: 'Jira' };
const LABEL_COLORS = ['#5e6ad2', '#26b5ce', '#4cb782', '#f2c94c', '#f2994a', '#eb5757', '#bb87fc'];

const tokenPurpose = (id: string) => `import-run:${id}`;

function colorFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return LABEL_COLORS[hash % LABEL_COLORS.length]!;
}

/**
 * Import from Linear and Jira (SPEC §10.2, ADR 0010). Admin-only (`org.manage`, checked by the
 * controller). Runs are resumable rows; writes go straight to the tables, so nobody is notified.
 */
export class ImportService {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(
    private readonly deps: {
      db: Db;
      box: SecretBox;
      org: OrgService;
      events: EventBus;
      sources: SourceFactory;
      maxAttachmentBytes: number;
      now?: () => Date;
      leaseMs?: number;
    },
  ) {}

  private get db(): Db {
    return this.deps.db;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async list(): Promise<ImportRunView[]> {
    const rows = await this.db.select().from(importRuns).orderBy(desc(importRuns.createdAt));
    return rows.map((row) => this.view(row));
  }

  async get(id: string): Promise<ImportRunView> {
    return this.view(await this.row(id));
  }

  /** Checks the token against the source and keeps it sealed for this run only. */
  async connect(memberId: string, input: ImportConnectInput): Promise<ImportRunView> {
    const baseUrl = input.source === 'jira' ? input.baseUrl.replace(/\/+$/, '') : null;
    const email = input.source === 'jira' ? (input.email ?? null) : null;
    const source = this.deps.sources({ source: input.source, baseUrl, email, token: input.token });
    const account = await this.call(() => source.account());
    const id = randomUUID();
    await this.db.insert(importRuns).values({
      id,
      source: input.source,
      sourceKey: baseUrl ? `jira:${baseUrl}` : 'linear',
      baseUrl,
      email,
      tokenEncrypted: this.deps.box.encrypt(input.token, tokenPurpose(id)),
      account,
      createdBy: memberId,
    });
    await this.audit(memberId, 'import.connected', id, { source: input.source, baseUrl });
    return this.get(id);
  }

  /** What can be imported: containers, and the people of the chosen ones with suggestions. */
  async options(id: string, containerIds?: string[]): Promise<ImportOptions> {
    const run = await this.row(id);
    const source = this.adapter(run);
    const containers = await this.call(() => source.containers());
    const chosen = containerIds?.length ? containerIds : containers.map((c) => c.id);
    const people = await this.call(() => source.people(chosen));
    const emails = people.flatMap((p) => (p.email ? [p.email.toLowerCase()] : []));
    const matches =
      emails.length === 0
        ? []
        : await this.db
            .select({ id: members.id, email: members.email })
            .from(members)
            .where(
              and(
                inArray(sql`lower(${members.email})`, emails),
                sql`${members.status} <> 'deactivated'`,
              ),
            );
    return {
      containers,
      people: people.map((p) => ({
        ...p,
        suggestedMemberId:
          matches.find((m) => m.email.toLowerCase() === p.email?.toLowerCase())?.id ?? null,
      })),
    };
  }

  async configure(memberId: string, id: string, config: ImportConfigData): Promise<ImportRunView> {
    const run = await this.row(id);
    if (run.status !== 'draft' && run.status !== 'paused')
      throw new DomainError('import_not_ready');
    for (const container of config.containers) {
      if (Boolean(container.teamId) === Boolean(container.newTeam)) {
        throw new DomainError('validation_failed');
      }
      if (container.teamId) {
        const [team] = await this.db.select().from(teams).where(eq(teams.id, container.teamId));
        if (!team || team.archivedAt) throw new DomainError('not_found');
      }
    }
    const people = [...new Set(Object.values(config.peopleMap).filter((v) => v !== null))];
    if (people.length > 0) {
      const found = await this.db
        .select({ id: members.id })
        .from(members)
        .where(inArray(members.id, people));
      if (found.length !== people.length) throw new DomainError('not_found');
    }
    await this.db.update(importRuns).set({ config }).where(eq(importRuns.id, id));
    await this.audit(memberId, 'import.configured', id, {
      containers: config.containers.map((c) => c.externalId),
    });
    return this.get(id);
  }

  /** Counts what a run would bring over, without writing anything. */
  async dryRun(id: string): Promise<ImportDryRun> {
    const run = await this.row(id);
    const config = this.config(run);
    const source = this.adapter(run);
    const containers = await this.call(() => source.containers());
    const result: ImportDryRun = {
      containers: [],
      unmappedPeople: [],
      oversizeAttachments: 0,
      warnings: [],
    };
    const unmapped = new Set<string>();
    const warnings = new Set<string>();
    const seen = (person: ExternalPerson | null) => {
      if (person && !(person.id in config.peopleMap)) unmapped.add(person.id);
    };
    for (const chosen of config.containers) {
      const container = containers.find((c) => c.id === chosen.externalId);
      if (!container) continue;
      const counts = {
        externalId: container.id,
        name: container.name,
        issues: 0,
        comments: 0,
        attachments: 0,
      };
      let cursor: string | null = null;
      for (let page = 0; page < DRY_RUN_PAGES; page++) {
        const next = await this.call(() => source.page(container, cursor, config));
        for (const issue of next.issues) {
          counts.issues++;
          counts.comments += issue.comments.length;
          counts.attachments += issue.attachments.length;
          result.oversizeAttachments += issue.attachments.filter(
            (a) => a.size !== null && a.size > this.deps.maxAttachmentBytes,
          ).length;
          issue.assignees.forEach(seen);
          seen(issue.creator);
          issue.comments.forEach((c) => seen(c.author));
          issue.dropped.forEach((d) => warnings.add(d));
        }
        cursor = next.next;
        if (!cursor) break;
      }
      if (cursor) warnings.add('truncated');
      result.containers.push(counts);
    }
    result.unmappedPeople = [...unmapped];
    result.warnings = [...warnings];
    return result;
  }

  async start(memberId: string, id: string): Promise<ImportRunView> {
    const run = await this.row(id);
    if (run.status === 'paused') {
      await this.setStatus(id, 'paused', { status: 'running' });
    } else if (run.status === 'draft') {
      const config = this.config(run);
      const map: Record<string, string> = {};
      for (const container of config.containers) {
        map[container.externalId] = container.newTeam
          ? await this.deps.org.createTeam(
              container.newTeam.departmentId,
              { name: container.newTeam.name, key: container.newTeam.key, isPrivate: false },
              { type: 'member', id: memberId },
            )
          : container.teamId!;
      }
      const cursor: Cursor = { index: 0, page: null, teams: map, pending: [], failures: 0 };
      await this.setStatus(id, 'draft', {
        status: 'running',
        cursor,
        counts: ZERO,
        report: [],
        startedAt: this.now(),
      });
    } else {
      throw new DomainError('import_not_ready');
    }
    await this.audit(memberId, 'import.started', id, {});
    return this.get(id);
  }

  async pause(memberId: string, id: string): Promise<ImportRunView> {
    await this.row(id);
    await this.setStatus(id, 'running', { status: 'paused' });
    await this.audit(memberId, 'import.paused', id, {});
    return this.get(id);
  }

  /** Stops for good and erases the token; what was imported stays. */
  async cancel(memberId: string, id: string): Promise<ImportRunView> {
    const run = await this.row(id);
    if (!['draft', 'running', 'paused'].includes(run.status))
      throw new DomainError('import_not_ready');
    await this.db
      .update(importRuns)
      .set({ status: 'canceled', tokenEncrypted: null, finishedAt: this.now() })
      .where(eq(importRuns.id, id));
    await this.audit(memberId, 'import.canceled', id, {});
    return this.get(id);
  }

  /** Worker loop: keeps stepping while there is work, then naps. */
  startRunner(intervalMs = 15_000, log?: (message: string) => void): void {
    const loop = async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        while (await this.tick()) {
          /* keep going while pages remain */
        }
      } catch (error) {
        log?.(`Import runner failed: ${String(error)}`);
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

  /** One page of every running run; true when any work was done. */
  async tick(): Promise<boolean> {
    const running = await this.db
      .select({ id: importRuns.id })
      .from(importRuns)
      .where(eq(importRuns.status, 'running'));
    let worked = false;
    for (const run of running) worked = (await this.step(run.id)) || worked;
    return worked;
  }

  /** Tests and small imports: steps one run until it stops running. */
  async runToCompletion(id: string, maxSteps = 1000): Promise<ImportRunView> {
    for (let i = 0; i < maxSteps; i++) {
      if (!(await this.step(id))) break;
    }
    return this.get(id);
  }

  /** Claims the run with a lease, imports one page and saves where it got to. */
  async step(id: string): Promise<boolean> {
    const now = this.now();
    const [run] = await this.db
      .update(importRuns)
      .set({ leaseUntil: new Date(now.getTime() + (this.deps.leaseMs ?? 10 * 60_000)) })
      .where(
        and(
          eq(importRuns.id, id),
          eq(importRuns.status, 'running'),
          or(isNull(importRuns.leaseUntil), lt(importRuns.leaseUntil, now)),
        ),
      )
      .returning();
    if (!run) return false;
    const cursor = run.cursor as Cursor;
    if (cursor.waitUntil && new Date(cursor.waitUntil) > now) {
      await this.db.update(importRuns).set({ leaseUntil: null }).where(eq(importRuns.id, id));
      return false;
    }
    const counts: ImportCounts = { ...ZERO, ...(run.counts as Partial<ImportCounts>) };
    const report = run.report as ImportReportItem[];
    try {
      const done = await this.importPage(run, cursor, counts, report);
      delete cursor.waitUntil;
      cursor.failures = 0;
      await this.db
        .update(importRuns)
        .set({ cursor, counts, report, leaseUntil: null })
        .where(eq(importRuns.id, id));
      if (done) {
        await this.setStatus(id, 'running', {
          status: 'completed',
          tokenEncrypted: null,
          finishedAt: this.now(),
        });
        await this.audit(run.createdBy, 'import.completed', id, counts);
      }
      return true;
    } catch (error) {
      const auth = error instanceof SourceError && error.code === 'import_auth_failed';
      cursor.failures = (cursor.failures ?? 0) + 1;
      const wait =
        error instanceof SourceError && error.retryAfterMs
          ? error.retryAfterMs
          : 30_000 * cursor.failures;
      cursor.waitUntil = new Date(this.now().getTime() + wait).toISOString();
      await this.db
        .update(importRuns)
        .set({ cursor, counts, report, leaseUntil: null })
        .where(eq(importRuns.id, id));
      if (auth || cursor.failures >= MAX_FAILURES) {
        await this.setStatus(id, 'running', {
          status: 'failed',
          error: auth
            ? 'import_auth_failed'
            : String((error as Error).message ?? error).slice(0, 500),
          finishedAt: this.now(),
        });
      }
      return false;
    }
  }

  /** Returns true once every container is done and sub-issues are linked. */
  private async importPage(
    run: Run,
    cursor: Cursor,
    counts: ImportCounts,
    report: ImportReportItem[],
  ): Promise<boolean> {
    const config = this.config(run);
    const chosen = config.containers[cursor.index];
    if (!chosen) {
      await this.linkPending(run, cursor);
      return true;
    }
    const source = this.adapter(run);
    const page = await source.page(
      { id: chosen.externalId, key: '', name: '', statuses: [] },
      cursor.page,
      config,
    );
    const team = await this.teamContext(cursor.teams[chosen.externalId]!);
    for (const issue of page.issues) {
      try {
        const item = await this.writeIssue(
          run,
          source,
          team,
          config,
          cursor,
          chosen.externalId,
          issue,
          counts,
        );
        counts[item.outcome]++;
        if (item.outcome !== 'skipped' || item.reason) this.addReport(report, item);
      } catch (error) {
        if (error instanceof SourceError && error.code === 'import_auth_failed') throw error;
        counts.failed++;
        this.addReport(report, {
          key: issue.key,
          outcome: 'failed',
          reason: String((error as Error).message ?? error).slice(0, 200),
        });
      }
    }
    cursor.page = page.next;
    if (!page.next) cursor.index++;
    await this.deps.events.publish({ type: 'team.changed', teamId: team.id });
    return false;
  }

  private async writeIssue(
    run: Run,
    source: ImportSourceAdapter,
    team: TeamContext,
    config: ImportConfigData,
    cursor: Cursor,
    containerId: string,
    issue: ExternalIssue,
    counts: ImportCounts,
  ): Promise<ImportReportItem> {
    const [ref] = await this.db
      .select()
      .from(externalRefs)
      .where(this.refWhere(run.sourceKey, 'issue', issue.externalId));
    let existing: { id: string; number: number; teamId: string } | undefined;
    if (ref) {
      const [row] = await this.db
        .select({
          id: issues.id,
          number: issues.number,
          teamId: issues.teamId,
          archivedAt: issues.archivedAt,
        })
        .from(issues)
        .where(eq(issues.id, ref.ordlerId));
      if (!row || row.archivedAt)
        return { key: issue.key, outcome: 'skipped', reason: 'deleted_in_ordler' };
      if (ref.sourceUpdatedAt?.getTime() === new Date(issue.updatedAt).getTime()) {
        return { key: issue.key, outcome: 'skipped' };
      }
      existing = row;
    }
    // A re-run keeps the issue where it was first imported.
    const target =
      existing && existing.teamId !== team.id ? await this.teamContext(existing.teamId) : team;
    const person = (p: ExternalPerson | null) => (p ? (config.peopleMap[p.id] ?? null) : null);

    const files = await this.attachmentsFor(run, source, target.id, issue, counts);
    const texts = [issue.description, ...issue.comments.map((c) => c.body)].join('\n');
    const unreferenced = [...files].filter(([ref]) => !texts.includes(ref));
    let description = this.rewrite(issue.description, files);
    if (unreferenced.length > 0) {
      description += `\n\n---\n${unreferenced.map(([, f]) => `- [${f.filename}](${f.url})`).join('\n')}`;
    }
    description = description.slice(0, 100_000);

    const statusId = this.pickStatus(target, config, containerId, issue);
    const assigneeIds = [
      ...new Set(issue.assignees.map(person).filter((id): id is string => !!id)),
    ];
    for (const memberId of assigneeIds) {
      if (target.members.has(memberId)) continue;
      // The admin mapped this person: they join the team so the assignment is valid.
      await this.db
        .insert(teamMemberships)
        .values({ teamId: target.id, memberId })
        .onConflictDoNothing();
      target.members.add(memberId);
    }
    const labelIds = await this.ensureLabels(target, issue.labels);
    const parentRef = issue.parentExternalId
      ? await this.refOf(run.sourceKey, issue.parentExternalId)
      : undefined;
    const knownComments = new Set(
      issue.comments.length === 0
        ? []
        : (
            await this.db
              .select({ externalId: externalRefs.externalId })
              .from(externalRefs)
              .where(
                and(
                  eq(externalRefs.sourceKey, run.sourceKey),
                  eq(externalRefs.kind, 'comment'),
                  inArray(
                    externalRefs.externalId,
                    issue.comments.map((c) => c.externalId),
                  ),
                ),
              )
          ).map((r) => r.externalId),
    );
    const newComments = issue.comments.filter((c) => !knownComments.has(c.externalId));
    const parentId = parentRef && parentRef.teamId === target.id ? parentRef.id : null;
    const createdAt = new Date(issue.createdAt);
    const updatedAt = new Date(issue.updatedAt);
    const imported = { source: run.source, key: issue.key, url: issue.url };
    const fields = {
      title: issue.title.trim().slice(0, 255) || issue.key,
      description,
      statusId,
      priority: issue.priority,
      assigneeId: assigneeIds[0] ?? null,
      dueDate: issue.dueDate,
      externalKey: issue.key,
      updatedAt,
    };

    const result = await this.db.transaction(async (tx) => {
      let issueId: string;
      let number: number;
      if (existing) {
        issueId = existing.id;
        number = existing.number;
        await tx
          .update(issues)
          .set({ ...fields, ...(parentId ? { parentId } : {}) })
          .where(eq(issues.id, issueId));
        await tx.delete(issueAssignees).where(eq(issueAssignees.issueId, issueId));
        await tx.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
      } else {
        const [counter] = await tx
          .update(teams)
          .set({ issueCounter: sql`${teams.issueCounter} + 1` })
          .where(eq(teams.id, target.id))
          .returning({ number: teams.issueCounter });
        number = counter!.number;
        const [row] = await tx
          .insert(issues)
          .values({
            ...fields,
            teamId: target.id,
            number,
            // Imported in creation order: the newest ends up on top of its column.
            sortOrder: -number,
            subOrder: number,
            parentId,
            createdBy: person(issue.creator),
            createdAt,
          })
          .returning({ id: issues.id });
        issueId = row!.id;
      }
      if (assigneeIds.length > 0) {
        await tx
          .insert(issueAssignees)
          .values(assigneeIds.map((memberId, position) => ({ issueId, memberId, position })));
      }
      if (labelIds.length > 0) {
        await tx.insert(issueLabels).values(labelIds.map((labelId) => ({ issueId, labelId })));
      }
      // One history entry instead of replaying the source's field history (SPEC §10.2).
      await tx.insert(issueEvents).values({
        issueId,
        actorId: run.createdBy,
        kind: existing ? 'updated' : 'created',
        changes: { imported: { from: null, to: imported } },
        createdAt: existing ? this.now() : createdAt,
      });
      for (const comment of newComments) {
        const authorId = person(comment.author);
        const body = authorId
          ? comment.body
          : `**${comment.author?.name ?? SOURCE_NAME[run.source]}** · ${SOURCE_NAME[run.source]}\n\n${comment.body}`;
        const [row] = await tx
          .insert(comments)
          .values({
            subjectType: 'issue',
            subjectId: issueId,
            authorId,
            body: this.rewrite(body, files).slice(0, 100_000),
            createdAt: new Date(comment.createdAt),
            updatedAt: new Date(comment.createdAt),
          })
          .returning({ id: comments.id });
        await tx.insert(externalRefs).values({
          sourceKey: run.sourceKey,
          kind: 'comment',
          externalId: comment.externalId,
          ordlerId: row!.id,
          importRunId: run.id,
        });
      }
      await tx
        .insert(externalRefs)
        .values({
          sourceKey: run.sourceKey,
          kind: 'issue',
          externalId: issue.externalId,
          ordlerId: issueId,
          sourceUpdatedAt: updatedAt,
          importRunId: run.id,
        })
        .onConflictDoUpdate({
          target: [externalRefs.sourceKey, externalRefs.kind, externalRefs.externalId],
          set: { sourceUpdatedAt: updatedAt, importRunId: run.id },
        });
      return { issueId, number };
    });
    counts.comments += newComments.length;
    if (issue.parentExternalId && !parentId) {
      cursor.pending.push({ issueId: result.issueId, parent: issue.parentExternalId });
    }
    return {
      key: issue.key,
      outcome: existing ? 'updated' : 'imported',
      identifier: `${target.key}-${result.number}`,
      ...(issue.dropped.length > 0 ? { reason: `not_imported:${issue.dropped.join(',')}` } : {}),
    };
  }

  /** Uploads an issue's files once; returns text reference → stored file. */
  private async attachmentsFor(
    run: Run,
    source: ImportSourceAdapter,
    teamId: string,
    issue: ExternalIssue,
    counts: ImportCounts,
  ): Promise<Map<string, { filename: string; url: string }>> {
    const files = new Map<string, { filename: string; url: string }>();
    for (const file of issue.attachments) {
      const externalId = `${issue.externalId}:${file.ref}`;
      const [known] = await this.db
        .select({ id: attachments.id, filename: attachments.filename })
        .from(externalRefs)
        .innerJoin(attachments, eq(attachments.id, externalRefs.ordlerId))
        .where(this.refWhere(run.sourceKey, 'attachment', externalId));
      if (known) {
        files.set(file.ref, {
          filename: known.filename,
          url: attachmentUrl(known.id, known.filename),
        });
        continue;
      }
      if (file.size !== null && file.size > this.deps.maxAttachmentBytes) continue;
      let download: { data: Buffer; contentType: string };
      try {
        download = await source.download(file.url);
      } catch (error) {
        if (error instanceof SourceError && error.code === 'import_auth_failed') throw error;
        continue;
      }
      if (download.data.length === 0 || download.data.length > this.deps.maxAttachmentBytes)
        continue;
      const stored = await storeAttachment(this.db, {
        teamId,
        uploadedBy: run.createdBy,
        file: { filename: file.filename, mimetype: download.contentType, data: download.data },
      });
      await this.db.insert(externalRefs).values({
        sourceKey: run.sourceKey,
        kind: 'attachment',
        externalId,
        ordlerId: stored.id,
        importRunId: run.id,
      });
      counts.attachments++;
      files.set(file.ref, { filename: stored.filename, url: stored.url });
    }
    return files;
  }

  /** Points `jira-attachment:` links and Linear upload URLs at the stored copies. */
  private rewrite(text: string, files: Map<string, { url: string }>): string {
    let out = text;
    for (const [ref, file] of files) {
      out = out.split(`${ATTACHMENT_REF}${ref}`).join(file.url);
      if (ref.startsWith('https://')) out = out.split(ref).join(file.url);
    }
    return out;
  }

  private pickStatus(
    team: TeamContext,
    config: ImportConfigData,
    containerId: string,
    issue: ExternalIssue,
  ): string {
    const mapped = config.statusMap[containerId]?.[issue.status.name];
    if (mapped && team.statuses.some((s) => s.id === mapped)) return mapped;
    const sameCategory = team.statuses.filter((s) => s.category === issue.status.category);
    return (
      sameCategory.find((s) => s.isDefault) ??
      sameCategory[0] ??
      team.statuses.find((s) => s.isDefault) ??
      team.statuses[0]!
    ).id;
  }

  private async ensureLabels(team: TeamContext, names: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const raw of names) {
      const name = raw.trim().slice(0, 60);
      if (!name) continue;
      let id = team.labels.get(name.toLowerCase());
      if (!id) {
        const [row] = await this.db
          .insert(labels)
          .values({ teamId: team.id, name, color: colorFor(name) })
          .returning({ id: labels.id });
        id = row!.id;
        team.labels.set(name.toLowerCase(), id);
      }
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  private async teamContext(teamId: string): Promise<TeamContext> {
    const [team] = await this.db.select().from(teams).where(eq(teams.id, teamId));
    if (!team) throw new Error('Import team is gone');
    const labelRows = await this.db
      .select({ id: labels.id, name: labels.name, teamId: labels.teamId })
      .from(labels)
      .where(or(eq(labels.teamId, teamId), isNull(labels.teamId)));
    // Team labels win over organization labels of the same name.
    const labelMap = new Map<string, string>();
    for (const row of [
      ...labelRows.filter((r) => !r.teamId),
      ...labelRows.filter((r) => r.teamId),
    ]) {
      labelMap.set(row.name.toLowerCase(), row.id);
    }
    const memberRows = await this.db
      .select({ id: teamMemberships.memberId })
      .from(teamMemberships)
      .where(eq(teamMemberships.teamId, teamId));
    return {
      id: team.id,
      key: team.key,
      statuses: await teamStatuses(this.db, teamId),
      labels: labelMap,
      members: new Set(memberRows.map((m) => m.id)),
    };
  }

  /** Links sub-issues whose parent came in a later page; parents in other teams are left out. */
  private async linkPending(run: Run, cursor: Cursor): Promise<void> {
    for (const item of cursor.pending) {
      const parent = await this.refOf(run.sourceKey, item.parent);
      if (!parent) continue;
      await this.db
        .update(issues)
        .set({ parentId: parent.id })
        .where(and(eq(issues.id, item.issueId), eq(issues.teamId, parent.teamId)));
    }
    cursor.pending = [];
  }

  private async refOf(sourceKey: string, externalId: string) {
    const [row] = await this.db
      .select({ id: issues.id, teamId: issues.teamId })
      .from(externalRefs)
      .innerJoin(issues, eq(issues.id, externalRefs.ordlerId))
      .where(and(this.refWhere(sourceKey, 'issue', externalId), isNull(issues.archivedAt)));
    return row;
  }

  private refWhere(
    sourceKey: string,
    kind: 'issue' | 'comment' | 'attachment',
    externalId: string,
  ) {
    return and(
      eq(externalRefs.sourceKey, sourceKey),
      eq(externalRefs.kind, kind),
      eq(externalRefs.externalId, externalId),
    );
  }

  private addReport(report: ImportReportItem[], item: ImportReportItem): void {
    // Failures matter most: once full, a failure replaces the oldest non-failure.
    if (report.length < REPORT_LIMIT) report.push(item);
    else if (item.outcome === 'failed') {
      const index = report.findIndex((r) => r.outcome !== 'failed');
      if (index >= 0) report.splice(index, 1, item);
    }
  }

  private adapter(run: Run): ImportSourceAdapter {
    const token = run.tokenEncrypted
      ? this.deps.box.decrypt(run.tokenEncrypted, tokenPurpose(run.id))
      : undefined;
    if (!token) throw new DomainError('import_not_ready');
    return this.deps.sources({
      source: run.source,
      baseUrl: run.baseUrl,
      email: run.email,
      token,
    });
  }

  private config(run: Run): ImportConfigData {
    const config = run.config as Partial<ImportConfigData>;
    if (!config.containers?.length) throw new DomainError('import_not_ready');
    return config as ImportConfigData;
  }

  /** Source failures become API errors the wizard can explain. */
  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof SourceError) throw new DomainError(error.code);
      throw error;
    }
  }

  private async setStatus(
    id: string,
    from: Run['status'],
    values: Partial<typeof importRuns.$inferInsert>,
  ): Promise<void> {
    const changed = await this.db
      .update(importRuns)
      .set(values)
      .where(and(eq(importRuns.id, id), eq(importRuns.status, from)))
      .returning({ id: importRuns.id });
    if (changed.length === 0) throw new DomainError('import_not_ready');
  }

  private async row(id: string): Promise<Run> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [row] = await this.db.select().from(importRuns).where(eq(importRuns.id, id));
    if (!row) throw new DomainError('not_found');
    return row;
  }

  /** Never includes the token. */
  private view(row: Run): ImportRunView {
    const config = row.config as Partial<ImportConfigData>;
    return {
      id: row.id,
      source: row.source,
      baseUrl: row.baseUrl,
      account: row.account as ImportRunView['account'],
      status: row.status,
      config: config.containers ? (config as ImportConfigData) : null,
      counts: { ...ZERO, ...(row.counts as Partial<ImportCounts>) },
      report: row.report as ImportReportItem[],
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }

  private async audit(
    memberId: string | null,
    action: string,
    id: string,
    after: object,
  ): Promise<void> {
    await writeAudit(this.db, {
      actor: memberId ? { type: 'member', id: memberId } : { type: 'system' },
      action,
      targetType: 'import_run',
      targetId: id,
      after,
    });
  }
}
