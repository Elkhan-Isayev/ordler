import type { CalendarView, SlaPolicyView } from '@ordler/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { DEPARTMENTS, DEPT_ID } from './fixtures.js';
import { SlaSection } from './SlaSection.js';

afterEach(() => vi.unstubAllGlobals());

const CALENDAR: CalendarView = {
  id: 'c1',
  departmentId: DEPT_ID,
  name: 'Office',
  timezone: 'Asia/Baku',
  hours: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '18:00' })),
  holidays: [],
};

describe('SlaSection', () => {
  it('creates a working-hours calendar', async () => {
    const calls = mockApi({
      'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
      [`GET /api/admin/departments/${DEPT_ID}/calendars`]: () => ({ json: [] }),
      [`GET /api/admin/departments/${DEPT_ID}/sla-policies`]: () => ({ json: [] }),
      [`POST /api/admin/departments/${DEPT_ID}/calendars`]: () => ({ status: 201, json: CALENDAR }),
    });
    await renderWithI18n(<SlaSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'New calendar' }));
    const form = screen.getByRole('form', { name: 'New calendar' });
    await userEvent.type(screen.getByLabelText('Name'), 'Office');
    const zone = screen.getByLabelText('Time zone');
    await userEvent.clear(zone);
    await userEvent.type(zone, 'Asia/Baku');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Fri' }));
    await userEvent.type(screen.getByLabelText(/Holidays/), '2026-12-31');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(form).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Office',
      timezone: 'Asia/Baku',
      hours: [1, 2, 3, 4].map((day) => ({ day, start: '09:00', end: '18:00' })),
      holidays: ['2026-12-31'],
    });
  });

  it('saves policy targets in minutes from hours', async () => {
    const policy: SlaPolicyView = {
      id: 'p1',
      departmentId: DEPT_ID,
      name: 'Standard',
      calendar: { id: 'c1', name: 'Office' },
      pauseDuringApproval: true,
      targets: {
        none: { firstResponseMinutes: 60, resolutionMinutes: null },
        urgent: { firstResponseMinutes: 15, resolutionMinutes: 240 },
        high: { firstResponseMinutes: null, resolutionMinutes: null },
        medium: { firstResponseMinutes: null, resolutionMinutes: null },
        low: { firstResponseMinutes: null, resolutionMinutes: null },
      },
      archivedAt: null,
    };
    const calls = mockApi({
      'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
      [`GET /api/admin/departments/${DEPT_ID}/calendars`]: () => ({ json: [CALENDAR] }),
      [`GET /api/admin/departments/${DEPT_ID}/sla-policies`]: () => ({ json: [policy] }),
      'PUT /api/admin/sla-policies/p1': () => ({ json: policy }),
    });
    await renderWithI18n(<SlaSection />);
    await screen.findByText('Standard');
    // The second Edit belongs to the policy row.
    const edits = screen.getAllByRole('button', { name: 'Edit' });
    await userEvent.click(edits[edits.length - 1]!);
    expect(screen.getByLabelText('First response for Urgent')).toHaveValue('0.25');
    const field = screen.getByLabelText('Resolution for High');
    await userEvent.type(field, '1.5');
    await userEvent.click(screen.getByRole('checkbox', { name: /Pause the clock/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({
      name: 'Standard',
      calendarId: 'c1',
      pauseDuringApproval: false,
      targets: {
        none: { firstResponseMinutes: 60, resolutionMinutes: null },
        urgent: { firstResponseMinutes: 15, resolutionMinutes: 240 },
        high: { firstResponseMinutes: null, resolutionMinutes: 90 },
      },
    });
  });
});
