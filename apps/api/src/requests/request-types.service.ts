import type { SlaService } from '../sla/sla.service.js';
import {
  can,
  ORGANIZATION_SCOPE,
  type ApprovalStepInput,
  type FormField,
  type PortalView,
  type RequestTypeInput,
  type RequestTypeView,
} from '@ordler/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import { departments, members, requestTypes, roles, teams } from '../db/schema.js';
import type { AccessContextSource } from '../rbac/permission.guard.js';
import { selectorNames } from './approvers.js';

type Row = typeof requestTypes.$inferSelect;

/**
 * Request types and service portals (SPEC §6.1). Managing a type needs request_type.manage on
 * its department; any member with request.create sees every portal.
 */
export class RequestTypeService {
  constructor(
    private readonly db: Db,
    private readonly access: AccessContextSource,
    private readonly sla?: SlaService,
  ) {}

  async portals(memberId: string): Promise<PortalView[]> {
    if (!(await this.has(memberId, 'request.create'))) throw new DomainError('forbidden');
    const rows = await this.db
      .select({ type: requestTypes, department: departments })
      .from(requestTypes)
      .innerJoin(departments, eq(departments.id, requestTypes.departmentId))
      .where(and(isNull(requestTypes.archivedAt), isNull(departments.archivedAt)))
      .orderBy(asc(departments.name), asc(requestTypes.name));
    const portals = new Map<string, PortalView>();
    for (const { type, department } of rows) {
      const portal = portals.get(department.id) ?? {
        department: { id: department.id, name: department.name },
        requestTypes: [],
      };
      portal.requestTypes.push({
        id: type.id,
        name: type.name,
        description: type.description,
        category: type.category,
      });
      portals.set(department.id, portal);
    }
    return [...portals.values()];
  }

  /** The form a requester fills in. */
  async get(memberId: string, id: string): Promise<RequestTypeView> {
    if (!(await this.has(memberId, 'request.create'))) throw new DomainError('forbidden');
    const row = await this.row(id);
    return this.view(row);
  }

  /** Every type of one department, archived included, for its admins. */
  async listForDepartment(memberId: string, departmentId: string): Promise<RequestTypeView[]> {
    await this.assertManager(memberId, departmentId);
    const rows = await this.db
      .select()
      .from(requestTypes)
      .where(eq(requestTypes.departmentId, departmentId))
      .orderBy(asc(requestTypes.name));
    return Promise.all(rows.map((row) => this.view(row)));
  }

  async create(
    memberId: string,
    departmentId: string,
    input: RequestTypeInput,
  ): Promise<RequestTypeView> {
    await this.assertManager(memberId, departmentId);
    await this.validate(departmentId, input);
    const [row] = await this.db
      .insert(requestTypes)
      .values({ departmentId, ...input })
      .returning();
    await this.audit(memberId, 'request_type.created', row!.id, undefined, input);
    return this.view(row!);
  }

  async update(memberId: string, id: string, input: RequestTypeInput): Promise<RequestTypeView> {
    const before = await this.row(id);
    await this.assertManager(memberId, before.departmentId);
    await this.validate(before.departmentId, input);
    const [row] = await this.db
      .update(requestTypes)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(requestTypes.id, id))
      .returning();
    await this.audit(memberId, 'request_type.updated', id, before, input);
    return this.view(row!);
  }

  /** Archived types leave the portal; existing requests keep working. */
  async archive(memberId: string, id: string): Promise<void> {
    const before = await this.row(id);
    await this.assertManager(memberId, before.departmentId);
    if (before.archivedAt) return;
    await this.db
      .update(requestTypes)
      .set({ archivedAt: new Date() })
      .where(eq(requestTypes.id, id));
    await this.audit(memberId, 'request_type.archived', id);
  }

  async row(id: string): Promise<Row> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [row] = await this.db.select().from(requestTypes).where(eq(requestTypes.id, id));
    if (!row) throw new DomainError('not_found');
    return row;
  }

  async view(row: Row): Promise<RequestTypeView> {
    const [department] = await this.db
      .select({ name: departments.name })
      .from(departments)
      .where(eq(departments.id, row.departmentId));
    const [team] = await this.db
      .select({ id: teams.id, key: teams.key, name: teams.name })
      .from(teams)
      .where(eq(teams.id, row.targetTeamId));
    const steps = row.approvalSteps as ApprovalStepInput[];
    return {
      id: row.id,
      departmentId: row.departmentId,
      departmentName: department?.name ?? '',
      name: row.name,
      description: row.description,
      category: row.category,
      fields: row.fields as FormField[],
      targetTeam: team!,
      approvalSteps: await Promise.all(
        steps.map(async (step) => ({
          ...step,
          names: await selectorNames(this.db, step.selector),
        })),
      ),
      allowRequesterApprovals: row.allowRequesterApprovals,
      slaPolicy: (await this.sla?.policyRef(row.slaPolicyId)) ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
    };
  }

  private async validate(departmentId: string, input: RequestTypeInput): Promise<void> {
    await this.sla?.assertUsable(departmentId, input.slaPolicyId);
    const [team] = await this.db.select().from(teams).where(eq(teams.id, input.targetTeamId));
    // Requests always land in a team of the department that offers the type.
    if (!team || team.departmentId !== departmentId || team.archivedAt) {
      throw new DomainError('validation_failed');
    }
    for (const { selector } of input.approvalSteps) {
      if (selector.type === 'user') {
        const [m] = await this.db
          .select({ id: members.id })
          .from(members)
          .where(eq(members.id, selector.memberId));
        if (!m) throw new DomainError('validation_failed');
      }
      if (selector.type === 'role') {
        const [r] = await this.db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.id, selector.roleId));
        if (!r) throw new DomainError('validation_failed');
      }
      if (selector.type === 'role' || selector.type === 'department_head') {
        const [d] = await this.db
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.id, selector.departmentId));
        if (!d) throw new DomainError('validation_failed');
      }
    }
  }

  private async assertManager(memberId: string, departmentId: string): Promise<void> {
    const loaded = await this.access.load(memberId);
    const allowed = can(
      loaded.assignments,
      loaded.rolePermissions,
      'request_type.manage',
      { type: 'department', id: departmentId },
      loaded.directory,
    );
    if (!allowed) throw new DomainError('forbidden');
  }

  private async has(memberId: string, permission: 'request.create'): Promise<boolean> {
    const loaded = await this.access.load(memberId);
    // request.create at any scope lets a member use the portals.
    return (
      can(
        loaded.assignments,
        loaded.rolePermissions,
        permission,
        ORGANIZATION_SCOPE,
        loaded.directory,
      ) ||
      loaded.assignments.some((a) => (loaded.rolePermissions(a.roleId) ?? []).includes(permission))
    );
  }

  private async audit(
    memberId: string,
    action: string,
    targetId: string,
    before?: unknown,
    after?: unknown,
  ): Promise<void> {
    const actor: AuditActor = { type: 'member', id: memberId };
    await writeAudit(this.db, {
      actor,
      action,
      targetType: 'request_type',
      targetId,
      before,
      after,
    });
  }
}
