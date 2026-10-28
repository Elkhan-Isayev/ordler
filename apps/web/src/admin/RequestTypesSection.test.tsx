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
        },
      ],
      allowRequesterApprovals: false,
      slaPolicyId: 'p1',
    });
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
