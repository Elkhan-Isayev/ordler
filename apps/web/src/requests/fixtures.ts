import type { ApprovalStepView, DirectoryView, RequestTypeView, RequestView } from '@ordler/shared';

export const DIRECTORY: DirectoryView = {
  members: [
    { id: 'm-ann', name: 'Ann Lee' },
    { id: 'm-fin', name: 'Fiona Finance' },
  ],
  departments: [
    { id: 'd-fin', name: 'Finance' },
    { id: 'd-it', name: 'IT' },
  ],
  roles: [
    { id: 'r-sup', key: 'department_supervisor', name: 'Department Supervisor' },
    { id: 'r-owner', key: 'owner', name: 'Owner' },
  ],
};

export const HARDWARE: RequestTypeView = {
  id: '01a13d37-d040-7000-b257-0000000000a1',
  departmentId: 'd-it',
  departmentName: 'IT',
  name: 'Hardware purchase',
  description: 'Laptops, headsets, monitors',
  category: null,
  fields: [
    { id: 'item', label: 'Item', type: 'select', required: true, options: ['Headset', 'Laptop'] },
    { id: 'quantity', label: 'Quantity', type: 'number', required: true },
  ],
  targetTeam: { id: 't-help', key: 'HELP', name: 'Helpdesk' },
  approvalSteps: [
    { selector: { type: 'requester_department_supervisor' }, rule: 'any', names: {} },
  ],
  allowRequesterApprovals: true,
  slaPolicy: null,
  archivedAt: null,
};

export const PAYROLL: RequestTypeView = {
  ...HARDWARE,
  id: '01a13d37-d040-7000-b257-0000000000a2',
  departmentId: 'd-fin',
  departmentName: 'Finance',
  name: 'Payroll setup',
  fields: [],
  approvalSteps: [],
  targetTeam: { id: 't-acc', key: 'ACC', name: 'Accounting' },
};

export function step(overrides: Partial<ApprovalStepView> = {}): ApprovalStepView {
  return {
    id: 's1',
    position: 0,
    origin: 'mandatory',
    level: 'request',
    selector: { type: 'requester_department_supervisor' },
    names: {},
    rule: 'any',
    status: 'active',
    approvers: [{ id: 'm-boss', name: 'Cora Boss' }],
    decisions: [],
    canDecide: false,
    ...overrides,
  };
}

export function request(overrides: Partial<RequestView> = {}): RequestView {
  return {
    id: 'req1',
    identifier: 'REQ-7',
    title: '20 headsets',
    status: 'pending_approval',
    priority: 'none',
    requestType: { id: HARDWARE.id, name: 'Hardware purchase' },
    department: { id: 'd-it', name: 'IT' },
    targetTeam: { id: 't-help', key: 'HELP', name: 'Helpdesk' },
    requester: { id: 'm-ann', name: 'Ann Lee' },
    assignee: null,
    group: null,
    sla: null,
    slaClocks: null,
    createdAt: '2026-10-21T09:00:00.000Z',
    updatedAt: '2026-10-21T09:00:00.000Z',
    description: 'For the support team',
    fields: HARDWARE.fields,
    formData: { item: 'Headset', quantity: 20 },
    perspective: 'requester',
    approvals: [step()],
    comments: [],
    events: [
      {
        id: 'e1',
        kind: 'submitted',
        actor: { id: 'm-ann', name: 'Ann Lee' },
        data: {},
        createdAt: '2026-10-21T09:00:00.000Z',
      },
    ],
    linkedIssues: { kind: 'progress', done: 0, total: 0 },
    siblings: [],
    can: {
      act: false,
      commentPublic: true,
      commentInternal: false,
      resubmit: false,
      confirm: false,
      spawnIssue: false,
    },
    ...overrides,
  };
}
