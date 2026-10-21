import {
  can,
  ORGANIZATION_SCOPE,
  type CreateLabelInput,
  type LabelInput,
  type LabelView,
} from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import { issueLabels, labels, teams } from '../db/schema.js';
import type { AccessContextSource } from '../rbac/permission.guard.js';
import type { TeamAccess } from './team-access.js';

/** Unique violations from PostgreSQL become a readable domain error. */
function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string }; code?: string }) ?? {};
  return cause.code === '23505' || cause.cause?.code === '23505';
}

/**
 * Labels (SPEC §5.1). Team labels: anyone who may edit the team's issues creates them, team
 * managers rename or delete them. Organization labels need `org.manage`.
 */
export class LabelService {
  constructor(
    private readonly db: Db,
    private readonly access: AccessContextSource,
    private readonly teamAccess: TeamAccess,
  ) {}

  async create(memberId: string, input: CreateLabelInput): Promise<LabelView> {
    if (input.teamId) await this.assertTeam(memberId, input.teamId, 'create');
    else await this.assertOrg(memberId);
    try {
      const [row] = await this.db
        .insert(labels)
        .values({ teamId: input.teamId, name: input.name, color: input.color.toLowerCase() })
        .returning();
      return this.view(row!);
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError('label_name_taken');
      throw error;
    }
  }

  async update(memberId: string, id: string, input: LabelInput): Promise<LabelView> {
    const label = await this.authorized(memberId, id);
    try {
      const [row] = await this.db
        .update(labels)
        .set({ name: input.name, color: input.color.toLowerCase() })
        .where(eq(labels.id, label.id))
        .returning();
      return this.view(row!);
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError('label_name_taken');
      throw error;
    }
  }

  /** Removes the label from every issue; issue history keeps the old label ids. */
  async remove(memberId: string, id: string): Promise<void> {
    const label = await this.authorized(memberId, id);
    await this.db.transaction(async (tx) => {
      await tx.delete(issueLabels).where(eq(issueLabels.labelId, label.id));
      await tx.delete(labels).where(eq(labels.id, label.id));
    });
  }

  private async authorized(memberId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [label] = await this.db.select().from(labels).where(eq(labels.id, id));
    if (!label) throw new DomainError('not_found');
    if (label.teamId) await this.assertTeam(memberId, label.teamId, 'manage');
    else await this.assertOrg(memberId);
    return label;
  }

  private async assertTeam(memberId: string, teamId: string, need: 'create' | 'manage') {
    const [team] = await this.db.select().from(teams).where(eq(teams.id, teamId));
    if (!team) throw new DomainError('not_found');
    const perms = await this.teamAccess.forTeam(memberId, team);
    if (!perms.read) throw new DomainError('not_found');
    if (need === 'create' ? !perms.update : !perms.manage) throw new DomainError('forbidden');
  }

  private async assertOrg(memberId: string) {
    const access = await this.access.load(memberId);
    const ok = can(
      access.assignments,
      access.rolePermissions,
      'org.manage',
      ORGANIZATION_SCOPE,
      access.directory,
    );
    if (!ok) throw new DomainError('forbidden');
  }

  private view(row: typeof labels.$inferSelect): LabelView {
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      scope: row.teamId ? 'team' : 'organization',
    };
  }
}
