import { can, ORGANIZATION_SCOPE, type Permission, type Scope } from '@ordler/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { teamMemberships } from '../db/schema.js';
import type { AccessContextSource } from '../rbac/permission.guard.js';

export interface TeamPermissions {
  read: boolean;
  create: boolean;
  update: boolean;
  assign: boolean;
  comment: boolean;
  deleteAnyComment: boolean;
  /** Deleting issues archives them (issue.delete). */
  delete: boolean;
  /** Team settings: labels, workflow (team.update). */
  manage: boolean;
  /** Saving and editing the team's shared views (view.create_shared). */
  shareViews: boolean;
}

/**
 * What a member may do with a team's issues (SPEC §4.1): the permission must cover the team,
 * and a private team is visible only to its members and to organization admins.
 */
export class TeamAccess {
  constructor(
    private readonly db: Db,
    private readonly access: AccessContextSource,
  ) {}

  async forTeam(
    memberId: string,
    team: { id: string; isPrivate: boolean },
  ): Promise<TeamPermissions> {
    const loaded = await this.access.load(memberId);
    const has = (permission: Permission, scope: Scope = { type: 'team', id: team.id }) =>
      can(loaded.assignments, loaded.rolePermissions, permission, scope, loaded.directory);

    const visible =
      !team.isPrivate ||
      has('org.manage', ORGANIZATION_SCOPE) ||
      (await this.isMember(memberId, team.id));
    const read = visible && has('issue.read');
    return {
      read,
      create: read && has('issue.create'),
      update: read && has('issue.update'),
      assign: read && has('issue.assign'),
      comment: read && has('comment.create'),
      deleteAnyComment: read && has('comment.delete_any'),
      delete: read && has('issue.delete'),
      manage: read && has('team.update'),
      shareViews: read && has('view.create_shared'),
    };
  }

  private async isMember(memberId: string, teamId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(and(eq(teamMemberships.memberId, memberId), eq(teamMemberships.teamId, teamId)));
    return row !== undefined;
  }
}
