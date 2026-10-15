import { describe, expect, it } from 'vitest';
import { isPermission, PERMISSIONS } from './permissions.js';
import { SYSTEM_ROLES } from './roles.js';

describe('permission catalog', () => {
  it('has no duplicates', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it('recognises catalog entries only', () => {
    expect(isPermission('team.create')).toBe(true);
    expect(isPermission('team.destroy')).toBe(false);
  });
});

describe('system roles', () => {
  it('owner and org admin hold the full catalog', () => {
    expect(new Set(SYSTEM_ROLES.owner.permissions)).toEqual(new Set(PERMISSIONS));
    expect(new Set(SYSTEM_ROLES.org_admin.permissions)).toEqual(new Set(PERMISSIONS));
  });

  it('every role permission exists in the catalog', () => {
    for (const role of Object.values(SYSTEM_ROLES)) {
      for (const permission of role.permissions) {
        expect(isPermission(permission), `${role.key}: ${permission}`).toBe(true);
      }
    }
  });

  it('guests can only create requests', () => {
    expect(SYSTEM_ROLES.guest.permissions).toEqual(['request.create']);
  });

  it('viewers cannot write', () => {
    const viewer = SYSTEM_ROLES.viewer.permissions;
    expect(viewer).toContain('issue.read');
    expect(viewer).not.toContain('issue.create');
    expect(viewer).not.toContain('request.create');
  });

  it('personal tokens and MCP are available to everyone except guests', () => {
    for (const role of Object.values(SYSTEM_ROLES)) {
      const expected = role.key !== 'guest';
      expect(role.permissions.includes('token.create_personal'), role.key).toBe(expected);
      expect(role.permissions.includes('mcp.use'), role.key).toBe(expected);
    }
  });

  it('only admins manage authentication and mail', () => {
    for (const role of Object.values(SYSTEM_ROLES)) {
      const expected = role.key === 'owner' || role.key === 'org_admin';
      expect(role.permissions.includes('auth.manage'), role.key).toBe(expected);
      expect(role.permissions.includes('mail.manage'), role.key).toBe(expected);
    }
  });

  it('team leads triage but cannot manage request types', () => {
    const lead = SYSTEM_ROLES.team_lead.permissions;
    expect(lead).toContain('request.triage');
    expect(lead).not.toContain('request_type.manage');
  });

  it('roles carry no duplicate permissions', () => {
    for (const role of Object.values(SYSTEM_ROLES)) {
      expect(new Set(role.permissions).size, role.key).toBe(role.permissions.length);
    }
  });
});
