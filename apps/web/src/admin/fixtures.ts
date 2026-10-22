import type { AdminDepartment, AdminMember, AdminRole } from '@ordler/shared';

export const DEPT_ID = '01a13d37-d040-7000-b257-0000000000d1';
export const TEAM_ID = '01a13d37-d040-7000-b257-0000000000a1';

export const DEPARTMENTS: AdminDepartment[] = [
  {
    id: DEPT_ID,
    name: 'IT',
    headMemberId: null,
    archivedAt: null,
    teams: [
      {
        id: TEAM_ID,
        key: 'HELP',
        name: 'Helpdesk',
        isPrivate: false,
        multipleAssignees: false,
        archivedAt: null,
        memberCount: 2,
      },
    ],
  },
];

export const ROLES: AdminRole[] = [
  { id: 'r-owner', key: 'owner', name: 'Owner', permissions: [] },
  { id: 'r-lead', key: 'team_lead', name: 'Team Lead', permissions: [] },
  { id: 'r-member', key: 'member', name: 'Member', permissions: [] },
];

export const ANN: AdminMember = {
  id: 'm-ann',
  name: 'Ann Lee',
  email: 'ann@push30.test',
  status: 'active',
  createdAt: '2026-10-15T08:00:00Z',
  roles: [
    {
      assignmentId: 'a-1',
      roleId: 'r-lead',
      roleKey: 'team_lead',
      roleName: 'Team Lead',
      scope: { type: 'team', id: TEAM_ID },
    },
  ],
  teamIds: [TEAM_ID],
};

export const OWNER_MEMBER: AdminMember = {
  id: 'm1',
  name: 'Owner',
  email: 'owner@push30.test',
  status: 'active',
  createdAt: '2026-10-15T08:00:00Z',
  roles: [],
  teamIds: [],
};
