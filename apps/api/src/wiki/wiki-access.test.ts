import type { Permission, RoleAssignment } from '@ordler/shared';
import { describe, expect, it } from 'vitest';
import type { MemberAccess } from '../rbac/permission.guard.js';
import { evaluate } from './wiki-access.js';

const ROLES: Record<string, Permission[]> = {
  member: ['wiki.read', 'wiki.edit'],
  viewer: ['wiki.read'],
  head: ['wiki.read', 'wiki.edit', 'department.update'],
  admin: ['org.manage'],
  guest: ['request.create'],
};

function access(...assignments: RoleAssignment[]): MemberAccess {
  return {
    assignments,
    rolePermissions: (roleId) => ROLES[roleId],
    directory: { departmentOfTeam: (team) => (team === 'help' ? 'it' : 'fin') },
  };
}

const it_ = { id: 'it', wikiVisibility: 'department' as const };

describe('wiki access', () => {
  it('lets department and team grants read and edit their department only', () => {
    expect(
      evaluate(access({ roleId: 'member', scope: { type: 'department', id: 'it' } }), it_),
    ).toEqual({
      read: true,
      edit: true,
      manage: false,
    });
    expect(
      evaluate(access({ roleId: 'member', scope: { type: 'team', id: 'help' } }), it_),
    ).toEqual({
      read: true,
      edit: true,
      manage: false,
    });
    expect(evaluate(access({ roleId: 'member', scope: { type: 'team', id: 'acc' } }), it_)).toEqual(
      {
        read: false,
        edit: false,
        manage: false,
      },
    );
  });

  it('gives organization-visible spaces readers everywhere, but not editors', () => {
    const open = { ...it_, wikiVisibility: 'organization' as const };
    expect(
      evaluate(access({ roleId: 'member', scope: { type: 'team', id: 'acc' } }), open),
    ).toEqual({
      read: true,
      edit: false,
      manage: false,
    });
    expect(evaluate(access({ roleId: 'guest', scope: { type: 'organization' } }), open).read).toBe(
      false,
    );
  });

  it('lets department admins manage and organization admins see everything', () => {
    expect(
      evaluate(access({ roleId: 'head', scope: { type: 'department', id: 'it' } }), it_),
    ).toEqual({
      read: true,
      edit: true,
      manage: true,
    });
    expect(
      evaluate(access({ roleId: 'viewer', scope: { type: 'department', id: 'it' } }), it_),
    ).toEqual({
      read: true,
      edit: false,
      manage: false,
    });
    expect(evaluate(access({ roleId: 'admin', scope: { type: 'organization' } }), it_).read).toBe(
      true,
    );
  });
});
