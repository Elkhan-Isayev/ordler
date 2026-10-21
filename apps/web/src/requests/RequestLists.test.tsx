import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { HARDWARE, PAYROLL, request } from './fixtures.js';
import { PortalsPage } from './PortalsPage.js';
import { ApprovalsPage, MyRequestsPage } from './RequestLists.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('request lists', () => {
  it('lists my requests with their status', async () => {
    mockApi({ 'GET /api/me/requests': () => ({ json: [request({ status: 'in_progress' })] }) });
    await renderWithI18n(<MyRequestsPage />);
    const row = await screen.findByRole('link', { name: /REQ-7/ });
    expect(row).toHaveAttribute('href', '/requests/REQ-7');
    expect(row).toHaveTextContent('In progress');
  });

  it('lists approvals waiting for me', async () => {
    mockApi({
      'GET /api/me/approvals': () => ({
        json: [
          {
            stepId: 's1',
            selector: { type: 'role', roleId: 'r', departmentId: 'd' },
            names: { role: 'department_supervisor', department: 'Finance' },
            request: {
              identifier: 'REQ-7',
              title: '20 headsets',
              requester: { id: 'a', name: 'Ann Lee' },
              department: { id: 'd-it', name: 'IT' },
            },
            group: null,
            activatedAt: '2026-10-21T09:00:00.000Z',
          },
        ],
      }),
    });
    await renderWithI18n(<ApprovalsPage />);
    const row = await screen.findByRole('link', { name: /20 headsets/ });
    expect(row).toHaveTextContent('Ann Lee → IT');
    expect(row).toHaveTextContent('Department supervisor · Finance');
  });

  it('says when nothing waits', async () => {
    mockApi({ 'GET /api/me/approvals': () => ({ json: [] }) });
    await renderWithI18n(<ApprovalsPage />);
    expect(await screen.findByText('Nothing waits for your decision.')).toBeInTheDocument();
  });

  it('builds a request to several departments from the portals', async () => {
    mockApi({
      'GET /api/portals': () => ({
        json: [
          {
            department: { id: 'd-fin', name: 'Finance' },
            requestTypes: [{ id: PAYROLL.id, name: PAYROLL.name, description: '', category: null }],
          },
          {
            department: { id: 'd-it', name: 'IT' },
            requestTypes: [
              { id: HARDWARE.id, name: HARDWARE.name, description: '', category: null },
            ],
          },
        ],
      }),
    });
    await renderWithI18n(<PortalsPage />);
    expect(await screen.findByRole('link', { name: 'Hardware purchase' })).toHaveAttribute(
      'href',
      `/portals/new/${HARDWARE.id}`,
    );
    await userEvent.click(
      screen.getByLabelText('Add Payroll setup to a request to several departments'),
    );
    expect(screen.queryByRole('button', { name: /Request from/ })).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByLabelText('Add Hardware purchase to a request to several departments'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Request from 2 departments' }));
    await waitFor(() =>
      expect(window.location.pathname).toBe(`/portals/group/${PAYROLL.id},${HARDWARE.id}`),
    );
  });
});
