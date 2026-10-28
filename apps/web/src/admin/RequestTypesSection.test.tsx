import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DIRECTORY } from '../requests/fixtures.js';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { DEPARTMENTS, DEPT_ID, TEAM_ID } from './fixtures.js';
import { fieldIdFor, RequestTypesSection } from './RequestTypesSection.js';

afterEach(() => vi.unstubAllGlobals());

describe('RequestTypesSection', () => {
  it('creates a request type with a form field and a mandatory approval', async () => {
    const calls = mockApi({
      'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
      'GET /api/directory': () => ({ json: DIRECTORY }),
      [`GET /api/admin/departments/${DEPT_ID}/request-types`]: () => ({ json: [] }),
      [`POST /api/admin/departments/${DEPT_ID}/request-types`]: () => ({ status: 201, json: {} }),
      [`GET /api/admin/departments/${DEPT_ID}/sla-policies`]: () => ({
        json: [{ id: 'p1', name: 'Standard' }],
      }),
    });
    await renderWithI18n(<RequestTypesSection />);
    await userEvent.click(await screen.findByRole('button', { name: '+ New request type' }));
    const form = screen.getByRole('form', { name: 'Request type' });
    await userEvent.type(within(form).getByLabelText('Name'), 'Hardware purchase');
    await userEvent.click(within(form).getByRole('button', { name: '+ Add field' }));
    await userEvent.type(within(form).getByLabelText('Field label'), 'Item');
    await userEvent.selectOptions(within(form).getByLabelText('Field type'), 'select');
    await userEvent.type(
      within(form).getByLabelText('Options, comma-separated'),
      'Headset, Laptop',
    );
    await userEvent.click(within(form).getByLabelText('Required'));
    await userEvent.click(within(form).getByRole('button', { name: '+ Add approval' }));
    await userEvent.selectOptions(
      within(form).getByLabelText('Approver'),
      'requester_department_supervisor',
    );
    await userEvent.selectOptions(within(form).getByLabelText('When nobody decides'), 'escalate');
    const hours = within(form).getByLabelText('Hours');
    await userEvent.clear(hours);
    await userEvent.type(hours, '8');
    await userEvent.selectOptions(within(form).getByLabelText('SLA policy'), 'p1');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Hardware purchase',
      description: '',
      category: null,
      targetTeamId: TEAM_ID,
      fields: [
        {
          id: 'field_1',
          label: 'Item',
          type: 'select',
          required: true,
          options: ['Headset', 'Laptop'],
        },
      ],
      approvalSteps: [
        {
          selector: { type: 'requester_department_supervisor' },
          rule: 'any',
          timeout: { hours: 8, action: 'escalate' },
          fallbackSelector: null,
          condition: null,
        },
      ],
      routingRules: [],
      allowRequesterApprovals: false,
      slaPolicyId: 'p1',
    });
  });

  it('builds a conditional field, a conditional step and a routing rule', async () => {
    const INFRA_ID = '01a13d37-d040-7000-b257-0000000000a2';
    const departments = [
      {
        ...DEPARTMENTS[0]!,
        teams: [
          ...DEPARTMENTS[0]!.teams,
          { ...DEPARTMENTS[0]!.teams[0]!, id: INFRA_ID, key: 'INFRA', name: 'Infrastructure' },
        ],
      },
    ];
    const calls = mockApi({
      'GET /api/admin/departments': () => ({ json: departments }),
      'GET /api/directory': () => ({ json: DIRECTORY }),
      [`GET /api/admin/departments/${DEPT_ID}/request-types`]: () => ({ json: [] }),
      [`POST /api/admin/departments/${DEPT_ID}/request-types`]: () => ({ status: 201, json: {} }),
      [`GET /api/admin/departments/${DEPT_ID}/sla-policies`]: () => ({ json: [] }),
    });
    await renderWithI18n(<RequestTypesSection />);
    await userEvent.click(await screen.findByRole('button', { name: '+ New request type' }));
    const form = screen.getByRole('form', { name: 'Request type' });
    await userEvent.type(within(form).getByLabelText('Name'), 'Hardware');
    await userEvent.click(within(form).getByRole('button', { name: '+ Add field' }));
    const first = within(form).getByRole('group', { name: 'Field 1' });
    await userEvent.type(within(first).getByLabelText('Field label'), 'Item');
    await userEvent.selectOptions(within(first).getByLabelText('Field type'), 'select');
    await userEvent.type(
      within(first).getByLabelText('Options, comma-separated'),
      'Laptop, Headset',
    );
    await userEvent.click(within(form).getByRole('button', { name: '+ Add field' }));
    const second = within(form).getByRole('group', { name: 'Field 2' });
    await userEvent.type(within(second).getByLabelText('Field label'), 'Model');
    // Field 2 shows only for laptops.
    const visibility = within(second).getByRole('group', { name: 'When field 2 shows' });
    await userEvent.selectOptions(within(visibility).getByLabelText('Field'), 'field_1');
    expect(within(visibility).getByLabelText('Operator')).toHaveValue('in');
    expect(within(visibility).getByLabelText('Laptop')).toBeChecked();

    await userEvent.click(within(form).getByRole('button', { name: '+ Add rule' }));
    const rule = within(form).getByRole('group', { name: 'Rule 1' });
    await userEvent.click(within(rule).getByLabelText('Headset'));
    await userEvent.click(within(rule).getByLabelText('Laptop'));
    await userEvent.selectOptions(within(rule).getByLabelText('Team of rule 1'), INFRA_ID);

    await userEvent.click(within(form).getByRole('button', { name: '+ Add approval' }));
    const step = within(form).getByRole('group', { name: 'When step 1 runs' });
    await userEvent.selectOptions(within(step).getByLabelText('Field'), 'field_1');
    await userEvent.selectOptions(within(step).getByLabelText('Operator'), 'not_in');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const body = calls.find((c) => c.method === 'POST')!.body as {
      fields: unknown[];
      routingRules: unknown[];
      approvalSteps: Array<{ condition: unknown }>;
    };
    expect(body.fields[1]).toMatchObject({
      visibleIf: { fieldId: 'field_1', op: 'in', values: ['Laptop'] },
    });
    // Ticking Headset then unticking Laptop leaves only Headset.
    expect(body.routingRules).toEqual([
      {
        condition: { fieldId: 'field_1', op: 'in', values: ['Headset'] },
        targetTeamId: INFRA_ID,
      },
    ]);
    expect(body.approvalSteps[0]!.condition).toEqual({
      fieldId: 'field_1',
      op: 'not_in',
      values: ['Laptop'],
    });
  });

  it('drops conditions on a removed field when saving', async () => {
    const calls = mockApi({
      'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
      'GET /api/directory': () => ({ json: DIRECTORY }),
      [`GET /api/admin/departments/${DEPT_ID}/request-types`]: () => ({ json: [] }),
      [`POST /api/admin/departments/${DEPT_ID}/request-types`]: () => ({ status: 201, json: {} }),
      [`GET /api/admin/departments/${DEPT_ID}/sla-policies`]: () => ({ json: [] }),
    });
    await renderWithI18n(<RequestTypesSection />);
    await userEvent.click(await screen.findByRole('button', { name: '+ New request type' }));
    const form = screen.getByRole('form', { name: 'Request type' });
    await userEvent.type(within(form).getByLabelText('Name'), 'Access');
    await userEvent.click(within(form).getByRole('button', { name: '+ Add field' }));
    await userEvent.type(within(form).getByLabelText('Field label'), 'Urgent');
    await userEvent.selectOptions(within(form).getByLabelText('Field type'), 'checkbox');
    await userEvent.click(within(form).getByRole('button', { name: '+ Add rule' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Remove field 1' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(
      (calls.find((c) => c.method === 'POST')!.body as { routingRules: unknown[] }).routingRules,
    ).toEqual([]);
  });
});

describe('fieldIdFor', () => {
  it('makes unique ids that the server accepts', () => {
    expect(fieldIdFor('Needed by', [])).toBe('needed_by');
    expect(fieldIdFor('Needed by', ['needed_by'])).toBe('needed_by_2');
    expect(fieldIdFor('Количество', [])).toBe('field');
    expect(fieldIdFor('2 monitors', [])).toBe('f_2_monitors');
  });
});
