import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { DIRECTORY, HARDWARE, PAYROLL, request } from './fixtures.js';
import { NewRequestPage } from './NewRequestPage.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const base = {
  [`GET /api/request-types/${HARDWARE.id}`]: () => ({ json: HARDWARE }),
  [`GET /api/request-types/${PAYROLL.id}`]: () => ({ json: PAYROLL }),
  'GET /api/directory': () => ({ json: DIRECTORY }),
};

describe('NewRequestPage', () => {
  it('shows the form and the required approvals, and checks answers before sending', async () => {
    const calls = mockApi(base);
    await renderWithI18n(<NewRequestPage typeIds={[HARDWARE.id]} />);
    expect(
      await screen.findByRole('heading', { name: 'IT · Hardware purchase' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Required approvals' })).toHaveTextContent(
      "Supervisor of the requester's department",
    );
    await userEvent.type(screen.getByLabelText('Title'), 'Headsets');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findAllByText('Required.')).toHaveLength(2);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('submits answers with a Finance approval added by the requester', async () => {
    const calls = mockApi({
      ...base,
      'POST /api/requests': () => ({ status: 201, json: request() }),
    });
    await renderWithI18n(<NewRequestPage typeIds={[HARDWARE.id]} />);
    await userEvent.type(await screen.findByLabelText('Title'), '20 headsets');
    await userEvent.selectOptions(screen.getByLabelText(/^Item/), 'Headset');
    await userEvent.type(screen.getByLabelText(/^Quantity/), '20');
    await userEvent.click(screen.getByRole('button', { name: '+ Add approval' }));
    const added = screen.getByRole('group', { name: 'Step 1' });
    expect(within(added).getByLabelText('Department')).toHaveValue('d-fin');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => expect(window.location.pathname).toBe('/requests/REQ-7'));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      requestTypeId: HARDWARE.id,
      title: '20 headsets',
      formData: { item: 'Headset', quantity: 20 },
      extraApprovals: [
        { selector: { type: 'role', roleId: 'r-sup', departmentId: 'd-fin' }, rule: 'any' },
      ],
    });
  });

  it('sends one request to several departments', async () => {
    const calls = mockApi({
      ...base,
      'POST /api/request-groups': () => ({
        status: 201,
        json: {
          id: 'g',
          identifier: 'REQ-G-2',
          title: 'x',
          status: 'in_progress',
          approvals: [],
          children: [],
        },
      }),
    });
    await renderWithI18n(<NewRequestPage typeIds={[HARDWARE.id, PAYROLL.id]} />);
    expect(await screen.findByText('Goes to: IT, Finance')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Title'), 'New hire');
    await userEvent.selectOptions(screen.getByLabelText(/^Item/), 'Laptop');
    await userEvent.type(screen.getByLabelText(/^Quantity/), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(window.location.pathname).toBe('/request-groups/REQ-G-2'));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      title: 'New hire',
      items: [
        { requestTypeId: HARDWARE.id, formData: { item: 'Laptop', quantity: 1 } },
        { requestTypeId: PAYROLL.id, formData: {} },
      ],
    });
  });
});
