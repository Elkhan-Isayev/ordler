import {
  isLocale,
  type AdminMember,
  type AdminRole,
  type AssignRoleInput,
  type InviteMemberInput,
  type ScopeInput,
} from '@ordler/shared';
import { and, asc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Clock } from '../auth/sessions.js';
import { hashPassword, type Argon2Params } from '../crypto/password.js';
import { randomToken, sha256 } from '../crypto/tokens.js';
import type { Db } from '../db/client.js';
import {
  departments,
  memberInvites,
  memberPasswords,
  members,
  roleAssignments,
  rolePermissions,
  roles,
  sessions,
  teamMemberships,
  teams,
} from '../db/schema.js';
import type { Mailer } from '../mail/mailer.js';
import { renderInviteEmail } from '../mail/templates.js';
import { getInstance } from '../setup/setup.service.js';
import { findMemberByEmail } from './members.js';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

type Actor = AuditActor & { type: 'member'; id: string };

export interface AdminMembersDeps {
  db: Db;
  baseUrl: string;
  mailer: Mailer | undefined;
  argon2?: Argon2Params;
  now?: Clock;
}

/** Admin → Members (SPEC §8): invites, status, roles and team membership. */
export class AdminMembersService {
  private readonly now: Clock;

  constructor(private readonly deps: AdminMembersDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private get db(): Db {
    return this.deps.db;
  }

  async list(): Promise<AdminMember[]> {
    const rows = await this.db.select().from(members).orderBy(asc(members.name));
    return this.views(rows.map((row) => row.id));
  }

  async get(id: string): Promise<AdminMember> {
    const [view] = await this.views([id]);
    if (!view) throw new DomainError('not_found');
    return view;
  }

  async roles(): Promise<AdminRole[]> {
    const rows = await this.db.select().from(roles).orderBy(asc(roles.name));
    const grants = await this.db.select().from(rolePermissions);
    return rows.map((role) => ({
      id: role.id,
      key: role.systemKey,
      name: role.name,
      permissions: grants
        .filter((g) => g.roleId === role.id)
        .map((g) => g.permission)
        .sort(),
    }));
  }

  /** Creates an invited member and a one-time link valid for 7 days. */
  async invite(
    input: InviteMemberInput,
    actor: Actor,
  ): Promise<{ member: AdminMember; inviteUrl: string; emailed: boolean }> {
    if (await findMemberByEmail(this.db, input.email)) throw new DomainError('email_taken');
    if (input.role) await this.assertCanGrant(input.role, actor);
    await this.assertTeamsExist(input.teamIds);

    const token = randomToken();
    const memberId = await this.db.transaction(async (tx) => {
      const db = tx as unknown as Db;
      const [member] = await db
        .insert(members)
        .values({ email: input.email, name: input.name, status: 'invited' })
        .returning({ id: members.id });
      const id = member!.id;
      await db.insert(memberInvites).values({
        memberId: id,
        tokenHash: sha256(token),
        expiresAt: new Date(this.now().getTime() + INVITE_TTL_MS),
        createdBy: actor.id,
      });
      if (input.role) await this.insertAssignment(db, id, input.role);
      if (input.teamIds.length > 0) {
        await db
          .insert(teamMemberships)
          .values(input.teamIds.map((teamId) => ({ teamId, memberId: id })))
          .onConflictDoNothing();
      }
      await writeAudit(db, {
        actor,
        action: 'member.invited',
        targetType: 'member',
        targetId: id,
        after: { email: input.email, role: input.role, teamIds: input.teamIds },
      });
      return id;
    });

    const inviteUrl = this.inviteUrl(token);
    const emailed = await this.sendInvite(input.email, inviteUrl);
    return { member: await this.get(memberId), inviteUrl, emailed };
  }

  /** Issues a fresh link and invalidates earlier ones, e.g. after the first one expired. */
  async reinvite(memberId: string, actor: Actor): Promise<{ inviteUrl: string; emailed: boolean }> {
    const member = await this.member(memberId);
    if (member.status !== 'invited') throw new DomainError('invite_invalid');
    const token = randomToken();
    await this.db.transaction(async (tx) => {
      await tx
        .update(memberInvites)
        .set({ expiresAt: this.now() })
        .where(and(eq(memberInvites.memberId, memberId), isNull(memberInvites.acceptedAt)));
      await tx.insert(memberInvites).values({
        memberId,
        tokenHash: sha256(token),
        expiresAt: new Date(this.now().getTime() + INVITE_TTL_MS),
        createdBy: actor.id,
      });
    });
    await writeAudit(this.db, {
      actor,
      action: 'member.reinvited',
      targetType: 'member',
      targetId: memberId,
    });
    const inviteUrl = this.inviteUrl(token);
    return { inviteUrl, emailed: await this.sendInvite(member.email, inviteUrl) };
  }

  /** What the invite page shows before the invitee commits: their email and the workspace. */
  async peekInvite(token: string): Promise<{ email: string; companyName: string }> {
    const [row] = await this.db
      .select({ email: members.email })
      .from(memberInvites)
      .innerJoin(members, eq(members.id, memberInvites.memberId))
      .where(
        and(
          eq(memberInvites.tokenHash, sha256(token)),
          isNull(memberInvites.acceptedAt),
          gt(memberInvites.expiresAt, this.now()),
          eq(members.status, 'invited'),
        ),
      );
    if (!row) throw new DomainError('invite_invalid');
    const instance = await getInstance(this.db);
    return { email: row.email, companyName: instance?.companyName ?? 'Ordler' };
  }

  /** The invitee sets their name and password; returns the member id to sign in. */
  async acceptInvite(token: string, name: string, password: string): Promise<string> {
    const now = this.now();
    const [invite] = await this.db
      .select({ id: memberInvites.id, memberId: memberInvites.memberId })
      .from(memberInvites)
      .innerJoin(members, eq(members.id, memberInvites.memberId))
      .where(
        and(
          eq(memberInvites.tokenHash, sha256(token)),
          isNull(memberInvites.acceptedAt),
          gt(memberInvites.expiresAt, now),
          eq(members.status, 'invited'),
        ),
      );
    if (!invite) throw new DomainError('invite_invalid');

    const hash = await hashPassword(password, this.deps.argon2);
    await this.db.transaction(async (tx) => {
      // Conditional update keeps the link single-use under concurrent submissions.
      const accepted = await tx
        .update(memberInvites)
        .set({ acceptedAt: now })
        .where(and(eq(memberInvites.id, invite.id), isNull(memberInvites.acceptedAt)))
        .returning({ id: memberInvites.id });
      if (accepted.length === 0) throw new DomainError('invite_invalid');
      await tx
        .update(members)
        .set({ name, status: 'active', emailVerifiedAt: now })
        .where(eq(members.id, invite.memberId));
      await tx
        .insert(memberPasswords)
        .values({ memberId: invite.memberId, hash })
        .onConflictDoUpdate({ target: memberPasswords.memberId, set: { hash, updatedAt: now } });
    });
    await writeAudit(this.db, {
      actor: { type: 'member', id: invite.memberId },
      action: 'member.invite_accepted',
      targetType: 'member',
      targetId: invite.memberId,
    });
    return invite.memberId;
  }

  async setStatus(
    memberId: string,
    status: 'active' | 'deactivated',
    actor: Actor,
  ): Promise<AdminMember> {
    if (memberId === actor.id) throw new DomainError('cannot_change_self');
    const member = await this.member(memberId);
    if (member.status === 'invited' && status === 'active') throw new DomainError('invite_invalid');
    if (status === 'deactivated' && (await this.isOwner(memberId))) {
      await this.assertAnotherActiveOwner(memberId);
    }
    await this.db.update(members).set({ status }).where(eq(members.id, memberId));
    // Deactivation ends every session immediately (SPEC §4).
    if (status === 'deactivated')
      await this.db.delete(sessions).where(eq(sessions.memberId, memberId));
    await writeAudit(this.db, {
      actor,
      action: status === 'active' ? 'member.reactivated' : 'member.deactivated',
      targetType: 'member',
      targetId: memberId,
      before: { status: member.status },
      after: { status },
    });
    return this.get(memberId);
  }

  async assignRole(memberId: string, input: AssignRoleInput, actor: Actor): Promise<AdminMember> {
    await this.member(memberId);
    await this.assertCanGrant(input, actor);
    await this.insertAssignment(this.db, memberId, input);
    await writeAudit(this.db, {
      actor,
      action: 'member.role_assigned',
      targetType: 'member',
      targetId: memberId,
      after: input,
    });
    return this.get(memberId);
  }

  async removeRole(memberId: string, assignmentId: string, actor: Actor): Promise<AdminMember> {
    const [assignment] = await this.db
      .select({
        id: roleAssignments.id,
        roleId: roleAssignments.roleId,
        key: roles.systemKey,
        scopeType: roleAssignments.scopeType,
        scopeId: roleAssignments.scopeId,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(eq(roleAssignments.id, assignmentId), eq(roleAssignments.memberId, memberId)));
    if (!assignment) throw new DomainError('not_found');
    if (assignment.key === 'owner') {
      if (!(await this.isOwner(actor.id))) throw new DomainError('owner_only');
      await this.assertAnotherActiveOwner(memberId);
    }
    await this.db.delete(roleAssignments).where(eq(roleAssignments.id, assignmentId));
    await writeAudit(this.db, {
      actor,
      action: 'member.role_removed',
      targetType: 'member',
      targetId: memberId,
      before: assignment,
    });
    return this.get(memberId);
  }

  async addToTeam(memberId: string, teamId: string, actor: Actor): Promise<AdminMember> {
    await this.member(memberId);
    await this.assertTeamsExist([teamId]);
    await this.db.insert(teamMemberships).values({ teamId, memberId }).onConflictDoNothing();
    await writeAudit(this.db, {
      actor,
      action: 'team.member_added',
      targetType: 'team',
      targetId: teamId,
      after: { memberId },
    });
    return this.get(memberId);
  }

  async removeFromTeam(memberId: string, teamId: string, actor: Actor): Promise<AdminMember> {
    await this.db
      .delete(teamMemberships)
      .where(and(eq(teamMemberships.memberId, memberId), eq(teamMemberships.teamId, teamId)));
    await writeAudit(this.db, {
      actor,
      action: 'team.member_removed',
      targetType: 'team',
      targetId: teamId,
      before: { memberId },
    });
    return this.get(memberId);
  }

  private async views(ids: string[]): Promise<AdminMember[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.select().from(members).where(inArray(members.id, ids));
    const grants = await this.db
      .select({
        assignmentId: roleAssignments.id,
        memberId: roleAssignments.memberId,
        roleId: roles.id,
        roleKey: roles.systemKey,
        roleName: roles.name,
        scopeType: roleAssignments.scopeType,
        scopeId: roleAssignments.scopeId,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(inArray(roleAssignments.memberId, ids));
    const memberships = await this.db
      .select()
      .from(teamMemberships)
      .where(inArray(teamMemberships.memberId, ids));

    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      return [
        {
          id: row.id,
          name: row.name,
          email: row.email,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          roles: grants
            .filter((g) => g.memberId === id)
            .map((g) => ({
              assignmentId: g.assignmentId,
              roleId: g.roleId,
              roleKey: g.roleKey,
              roleName: g.roleName,
              scope: toScope(g.scopeType, g.scopeId),
            })),
          teamIds: memberships.filter((m) => m.memberId === id).map((m) => m.teamId),
        },
      ];
    });
  }

  private async member(id: string) {
    const [row] = await this.db.select().from(members).where(eq(members.id, id));
    if (!row) throw new DomainError('not_found');
    return row;
  }

  private async isOwner(memberId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(eq(roleAssignments.memberId, memberId), eq(roles.systemKey, 'owner')));
    return row !== undefined;
  }

  /** The organization must always keep at least one active Owner (SPEC §4.2). */
  private async assertAnotherActiveOwner(memberId: string): Promise<void> {
    const [other] = await this.db
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .innerJoin(members, eq(members.id, roleAssignments.memberId))
      .where(
        and(
          eq(roles.systemKey, 'owner'),
          ne(roleAssignments.memberId, memberId),
          eq(members.status, 'active'),
        ),
      );
    if (!other) throw new DomainError('last_owner');
  }

  /** Only Owners may grant the Owner role; scopes must point at existing units. */
  private async assertCanGrant(input: AssignRoleInput, actor: Actor): Promise<void> {
    const [role] = await this.db.select().from(roles).where(eq(roles.id, input.roleId));
    if (!role) throw new DomainError('not_found');
    if (role.systemKey === 'owner') {
      if (input.scope.type !== 'organization') throw new DomainError('validation_failed');
      if (!(await this.isOwner(actor.id))) throw new DomainError('owner_only');
    }
    if (input.scope.type === 'department') {
      const [dept] = await this.db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.id, input.scope.id));
      if (!dept) throw new DomainError('not_found');
    }
    if (input.scope.type === 'team') await this.assertTeamsExist([input.scope.id]);
  }

  private async assertTeamsExist(teamIds: string[]): Promise<void> {
    if (teamIds.length === 0) return;
    const rows = await this.db
      .select({ id: teams.id, archivedAt: teams.archivedAt })
      .from(teams)
      .where(inArray(teams.id, teamIds));
    if (rows.length !== new Set(teamIds).size) throw new DomainError('not_found');
    if (rows.some((row) => row.archivedAt)) throw new DomainError('archived');
  }

  private async insertAssignment(db: Db, memberId: string, input: AssignRoleInput): Promise<void> {
    const scopeId = input.scope.type === 'organization' ? null : input.scope.id;
    const [existing] = await db
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.memberId, memberId),
          eq(roleAssignments.roleId, input.roleId),
          eq(roleAssignments.scopeType, input.scope.type),
          scopeId === null ? isNull(roleAssignments.scopeId) : eq(roleAssignments.scopeId, scopeId),
        ),
      );
    if (existing) return;
    await db
      .insert(roleAssignments)
      .values({ memberId, roleId: input.roleId, scopeType: input.scope.type, scopeId });
  }

  private inviteUrl(token: string): string {
    return `${this.deps.baseUrl}/invite/${token}`;
  }

  private async sendInvite(email: string, url: string): Promise<boolean> {
    if (!this.deps.mailer) return false;
    const instance = await getInstance(this.db);
    const locale = instance && isLocale(instance.defaultLocale) ? instance.defaultLocale : 'en';
    try {
      await this.deps.mailer.send({
        to: email,
        ...renderInviteEmail({ locale, company: instance?.companyName ?? 'Ordler', url, days: 7 }),
      });
      return true;
    } catch {
      // The admin still has the link to share by other means.
      return false;
    }
  }
}

function toScope(type: 'organization' | 'department' | 'team', id: string | null): ScopeInput {
  if (type === 'organization' || !id) return { type: 'organization' };
  return { type, id };
}
