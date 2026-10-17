import type { AdminDepartment } from '@ordler/shared';
import { asc, count, eq, isNull, sql } from 'drizzle-orm';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import { departments, teamMemberships, teams } from '../db/schema.js';
import { ensureTeamWorkflow } from '../issues/workflows.js';

/** Departments and their teams (SPEC §3, admin panel §8). */
export class OrgService {
  constructor(private readonly db: Db) {}

  async list(): Promise<AdminDepartment[]> {
    const deptRows = await this.db.select().from(departments).orderBy(asc(departments.name));
    const teamRows = await this.db
      .select({
        id: teams.id,
        departmentId: teams.departmentId,
        key: teams.key,
        name: teams.name,
        isPrivate: teams.isPrivate,
        archivedAt: teams.archivedAt,
        memberCount: count(teamMemberships.memberId),
      })
      .from(teams)
      .leftJoin(teamMemberships, eq(teamMemberships.teamId, teams.id))
      .groupBy(teams.id)
      .orderBy(asc(teams.name));

    return deptRows.map((dept) => ({
      id: dept.id,
      name: dept.name,
      archivedAt: dept.archivedAt?.toISOString() ?? null,
      teams: teamRows
        .filter((team) => team.departmentId === dept.id)
        .map((team) => ({
          id: team.id,
          key: team.key,
          name: team.name,
          isPrivate: team.isPrivate,
          archivedAt: team.archivedAt?.toISOString() ?? null,
          memberCount: Number(team.memberCount),
        })),
    }));
  }

  async createDepartment(name: string, actor: AuditActor): Promise<string> {
    await this.assertDepartmentNameFree(name);
    const [row] = await this.db.insert(departments).values({ name }).returning();
    await writeAudit(this.db, {
      actor,
      action: 'department.created',
      targetType: 'department',
      targetId: row!.id,
      after: { name },
    });
    return row!.id;
  }

  async updateDepartment(id: string, input: { name?: string | undefined }, actor: AuditActor) {
    const before = await this.department(id);
    if (input.name !== undefined && input.name !== before.name) {
      await this.assertDepartmentNameFree(input.name);
      await this.db.update(departments).set({ name: input.name }).where(eq(departments.id, id));
    }
    await writeAudit(this.db, {
      actor,
      action: 'department.updated',
      targetType: 'department',
      targetId: id,
      before: { name: before.name },
      after: input,
    });
  }

  /** Archived, never deleted: departments may own requests and history (SPEC §3). */
  async archiveDepartment(id: string, actor: AuditActor): Promise<void> {
    const dept = await this.department(id);
    if (dept.archivedAt) return;
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.update(departments).set({ archivedAt: now }).where(eq(departments.id, id));
      await tx
        .update(teams)
        .set({ archivedAt: now })
        .where(sql`${teams.departmentId} = ${id} and ${teams.archivedAt} is null`);
    });
    await writeAudit(this.db, {
      actor,
      action: 'department.archived',
      targetType: 'department',
      targetId: id,
    });
  }

  async createTeam(
    departmentId: string,
    input: { name: string; key: string; isPrivate: boolean },
    actor: AuditActor,
  ): Promise<string> {
    const dept = await this.department(departmentId);
    if (dept.archivedAt) throw new DomainError('archived');
    const [taken] = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.key, input.key));
    if (taken) throw new DomainError('team_key_taken');
    const [row] = await this.db
      .insert(teams)
      .values({ departmentId, name: input.name, key: input.key, isPrivate: input.isPrivate })
      .returning();
    await ensureTeamWorkflow(this.db, row!.id);
    await writeAudit(this.db, {
      actor,
      action: 'team.created',
      targetType: 'team',
      targetId: row!.id,
      after: { departmentId, ...input },
    });
    return row!.id;
  }

  async updateTeam(
    id: string,
    input: { name?: string | undefined; isPrivate?: boolean | undefined },
    actor: AuditActor,
  ): Promise<void> {
    const before = await this.team(id);
    await this.db
      .update(teams)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.isPrivate !== undefined ? { isPrivate: input.isPrivate } : {}),
      })
      .where(eq(teams.id, id));
    await writeAudit(this.db, {
      actor,
      action: 'team.updated',
      targetType: 'team',
      targetId: id,
      before: { name: before.name, isPrivate: before.isPrivate },
      after: input,
    });
  }

  async archiveTeam(id: string, actor: AuditActor): Promise<void> {
    const team = await this.team(id);
    if (team.archivedAt) return;
    await this.db.update(teams).set({ archivedAt: new Date() }).where(eq(teams.id, id));
    await writeAudit(this.db, { actor, action: 'team.archived', targetType: 'team', targetId: id });
  }

  async departmentOfTeam(teamId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ departmentId: teams.departmentId })
      .from(teams)
      .where(eq(teams.id, teamId));
    return row?.departmentId;
  }

  private async department(id: string) {
    const [row] = await this.db.select().from(departments).where(eq(departments.id, id));
    if (!row) throw new DomainError('not_found');
    return row;
  }

  private async team(id: string) {
    const [row] = await this.db.select().from(teams).where(eq(teams.id, id));
    if (!row) throw new DomainError('not_found');
    return row;
  }

  private async assertDepartmentNameFree(name: string): Promise<void> {
    const [taken] = await this.db
      .select({ id: departments.id })
      .from(departments)
      .where(
        sql`lower(${departments.name}) = lower(${name}) and ${isNull(departments.archivedAt)}`,
      );
    if (taken) throw new DomainError('department_name_taken');
  }
}
