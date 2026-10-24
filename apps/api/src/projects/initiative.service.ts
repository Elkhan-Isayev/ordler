import {
  can,
  ORGANIZATION_SCOPE,
  type InitiativeDetail,
  type InitiativeInput,
  type InitiativeSummary,
  type ProjectHealth,
  type ProjectSummary,
} from '@ordler/shared';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import { initiativeProjects, initiatives, members, projects } from '../db/schema.js';
import type { AccessContextSource } from '../rbac/permission.guard.js';
import type { ProjectService } from './project.service.js';

type Row = typeof initiatives.$inferSelect;
type ParsedInput = Required<InitiativeInput>;

const SEVERITY: Record<ProjectHealth, number> = { on_track: 0, at_risk: 1, off_track: 2 };

/** Worst health among projects that are still running. */
export function rollUpHealth(list: ProjectSummary[]): ProjectHealth | null {
  let worst: ProjectHealth | null = null;
  for (const project of list) {
    if (project.status === 'completed' || project.status === 'canceled' || !project.health)
      continue;
    if (!worst || SEVERITY[project.health] > SEVERITY[worst]) worst = project.health;
  }
  return worst;
}

/**
 * Initiatives (SPEC §5.2): organization-wide objectives everyone may read; each lists only
 * the projects the viewer can see. Creating needs `initiative.manage`; the owner may edit too.
 */
export class InitiativeService {
  constructor(
    private readonly deps: {
      db: Db;
      access: AccessContextSource;
      projects: ProjectService;
      now?: () => Date;
    },
  ) {}

  private get db(): Db {
    return this.deps.db;
  }

  async list(memberId: string): Promise<InitiativeSummary[]> {
    const rows = await this.db
      .select()
      .from(initiatives)
      .where(isNull(initiatives.archivedAt))
      .orderBy(desc(initiatives.updatedAt));
    const visible = await this.deps.projects.list(memberId);
    return this.summaries(rows, visible);
  }

  async get(memberId: string, id: string): Promise<InitiativeDetail> {
    const row = await this.row(id);
    const visible = await this.deps.projects.list(memberId);
    const [summary] = await this.summaries([row], visible);
    const linked = await this.projectIds([row.id]);
    return {
      ...summary!,
      description: row.description,
      projects: visible.filter((p) => linked.get(row.id)?.includes(p.id)),
      can: { edit: await this.canEdit(memberId, row) },
    };
  }

  async create(memberId: string, input: ParsedInput): Promise<InitiativeDetail> {
    if (!(await this.canManage(memberId))) throw new DomainError('forbidden');
    const [row] = await this.db
      .insert(initiatives)
      .values({ ...input, createdBy: memberId })
      .returning({ id: initiatives.id });
    await this.audit(memberId, 'initiative.created', row!.id, { name: input.name });
    return this.get(memberId, row!.id);
  }

  async update(
    memberId: string,
    id: string,
    input: Partial<ParsedInput>,
  ): Promise<InitiativeDetail> {
    await this.editable(memberId, id);
    await this.db
      .update(initiatives)
      .set({ ...input, updatedAt: this.deps.now?.() ?? new Date() })
      .where(eq(initiatives.id, id));
    await this.audit(memberId, 'initiative.updated', id, input);
    return this.get(memberId, id);
  }

  /** Sets the projects; ones the editor cannot see are kept as they were. */
  async setProjects(memberId: string, id: string, projectIds: string[]): Promise<InitiativeDetail> {
    await this.editable(memberId, id);
    const visible = new Set((await this.deps.projects.list(memberId)).map((p) => p.id));
    if (projectIds.some((p) => !visible.has(p))) throw new DomainError('not_found');
    const current = (await this.projectIds([id])).get(id) ?? [];
    const hidden = current.filter((p) => !visible.has(p));
    await this.db.transaction(async (tx) => {
      await tx.delete(initiativeProjects).where(eq(initiativeProjects.initiativeId, id));
      const next = [...new Set([...hidden, ...projectIds])];
      if (next.length > 0) {
        await tx
          .insert(initiativeProjects)
          .values(next.map((projectId) => ({ initiativeId: id, projectId })));
      }
      await tx
        .update(initiatives)
        .set({ updatedAt: this.deps.now?.() ?? new Date() })
        .where(eq(initiatives.id, id));
    });
    await this.audit(memberId, 'initiative.projects_set', id, { projectIds });
    return this.get(memberId, id);
  }

  async archive(memberId: string, id: string): Promise<void> {
    await this.editable(memberId, id);
    await this.db
      .update(initiatives)
      .set({ archivedAt: this.deps.now?.() ?? new Date() })
      .where(eq(initiatives.id, id));
    await this.audit(memberId, 'initiative.archived', id, {});
  }

  private async summaries(rows: Row[], visible: ProjectSummary[]): Promise<InitiativeSummary[]> {
    if (rows.length === 0) return [];
    const linked = await this.projectIds(rows.map((r) => r.id));
    const ownerIds = rows.flatMap((r) => (r.ownerId ? [r.ownerId] : []));
    const owners =
      ownerIds.length === 0
        ? []
        : await this.db
            .select({ id: members.id, name: members.name })
            .from(members)
            .where(inArray(members.id, ownerIds));
    return rows.map((row) => {
      const ids = linked.get(row.id) ?? [];
      const list = visible.filter((p) => ids.includes(p.id));
      const progress = list.reduce(
        (sum, p) => ({
          total: sum.total + p.progress.total,
          started: sum.started + p.progress.started,
          completed: sum.completed + p.progress.completed,
        }),
        { total: 0, started: 0, completed: 0 },
      );
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        owner: owners.find((o) => o.id === row.ownerId) ?? null,
        targetDate: row.targetDate,
        health: rollUpHealth(list),
        progress,
        projectCount: list.length,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  private async projectIds(ids: string[]): Promise<Map<string, string[]>> {
    const rows = await this.db
      .select({
        initiativeId: initiativeProjects.initiativeId,
        projectId: initiativeProjects.projectId,
      })
      .from(initiativeProjects)
      .innerJoin(projects, eq(projects.id, initiativeProjects.projectId))
      .where(and(inArray(initiativeProjects.initiativeId, ids), isNull(projects.archivedAt)))
      .orderBy(asc(projects.name));
    const map = new Map<string, string[]>();
    for (const r of rows)
      map.set(r.initiativeId, [...(map.get(r.initiativeId) ?? []), r.projectId]);
    return map;
  }

  private async canManage(memberId: string): Promise<boolean> {
    const loaded = await this.deps.access.load(memberId);
    return can(
      loaded.assignments,
      loaded.rolePermissions,
      'initiative.manage',
      ORGANIZATION_SCOPE,
      loaded.directory,
    );
  }

  private async canEdit(memberId: string, row: Row): Promise<boolean> {
    return row.ownerId === memberId || (await this.canManage(memberId));
  }

  private async editable(memberId: string, id: string): Promise<Row> {
    const row = await this.row(id);
    if (!(await this.canEdit(memberId, row))) throw new DomainError('forbidden');
    return row;
  }

  private async row(id: string): Promise<Row> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [row] = await this.db.select().from(initiatives).where(eq(initiatives.id, id));
    if (!row || row.archivedAt) throw new DomainError('not_found');
    return row;
  }

  private async audit(memberId: string, action: string, id: string, after: object): Promise<void> {
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action,
      targetType: 'initiative',
      targetId: id,
      after,
    });
  }
}
