import type { InitiativeDetail, ProjectSummary } from '@ordler/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { InitiativePage, InitiativesPage } from './InitiativePages.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const project = (id: string, name: string): ProjectSummary => ({
  id,
  name,
  status: 'in_progress',
  lead: null,
  teams: [],
  startDate: null,
  targetDate: null,
  progress: { total: 2, started: 0, completed: 1 },
  health: 'off_track',
  updatedAt: '2026-10-24T09:00:00.000Z',
});
const DETAIL: InitiativeDetail = {
  id: 'i-1',
  name: 'Growth 2027',
  status: 'active',
  owner: { id: 'm-ann', name: 'Ann Lee' },
  targetDate: '2027-06-30',
  health: 'off_track',
  progress: { total: 2, started: 0, completed: 1 },
  projectCount: 1,
  updatedAt: '2026-10-24T09:00:00.000Z',
  description: '',
  projects: [project('p-1', 'Office move')],
  can: { edit: true },
};

describe('InitiativesPage', () => {
  it('lists initiatives and lets initiative managers create one', async () => {
    const calls = mockApi({
      'GET /api/initiatives': () => ({ json: [DETAIL] }),
      'POST /api/initiatives': () => ({ status: 201, json: DETAIL }),
    });
    await renderWithI18n(<InitiativesPage canCreate />);
    const row = await screen.findByRole('link', { name: /Growth 2027/ });
    expect(within(row).getByText('Off track')).toBeInTheDocument();
    expect(within(row).getByText('1 project')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New initiative' }));
    await userEvent.type(screen.getByLabelText('Initiative name'), 'Growth 2027{Enter}');
    await waitFor(() => expect(window.location.pathname).toBe('/initiatives/i-1'));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Growth 2027' });
  });

  it('hides creation without initiative.manage', async () => {
    mockApi({ 'GET /api/initiatives': () => ({ json: [] }) });
    await renderWithI18n(<InitiativesPage canCreate={false} />);
    expect(await screen.findByText(/No initiatives yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New initiative' })).not.toBeInTheDocument();
  });
});

describe('InitiativePage', () => {
  it('adds and removes projects', async () => {
    const calls = mockApi({
      'GET /api/initiatives/i-1': () => ({ json: DETAIL }),
      'GET /api/directory': () => ({ json: { members: [], departments: [], roles: [] } }),
      'GET /api/projects': () => ({
        json: [project('p-1', 'Office move'), project('p-2', 'New laptops')],
      }),
      'PUT /api/initiatives/i-1/projects': () => ({ json: DETAIL }),
    });
    await renderWithI18n(<InitiativePage initiativeId="i-1" />, 'ru');
    expect(await screen.findByDisplayValue('Growth 2027')).toBeInTheDocument();
    await userEvent.selectOptions(await screen.findByLabelText('Добавить проект…'), 'p-2');
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ projectIds: ['p-1', 'p-2'] });
    await userEvent.click(screen.getByRole('button', { name: 'Убрать Office move' }));
    expect(calls.filter((c) => c.method === 'PUT').at(-1)!.body).toEqual({ projectIds: [] });
  });
});
