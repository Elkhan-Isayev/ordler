import type { ProjectDetail, ProjectSummary } from '@ordler/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issue, TEAM } from '../issues/fixtures.js';
import { applyFilters } from '../issues/filters.js';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { ProjectPage } from './ProjectPage.js';
import { ProjectPicker } from './ProjectPicker.js';
import { ProjectsPage } from './ProjectsPage.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const SUMMARY: ProjectSummary = {
  id: 'p-1',
  name: 'Office move',
  status: 'in_progress',
  lead: { id: 'm-ann', name: 'Ann Lee' },
  teams: [{ id: TEAM.id, key: 'HELP', name: 'Helpdesk' }],
  startDate: null,
  targetDate: '2026-12-01',
  progress: { total: 4, started: 1, completed: 3 },
  health: 'at_risk',
  updatedAt: '2026-10-24T09:00:00.000Z',
};
const DETAIL: ProjectDetail = {
  ...SUMMARY,
  description: 'Move to the new office.',
  members: [{ id: 'm-ann', name: 'Ann Lee' }],
  milestones: [
    {
      id: 'ms-1',
      name: 'Pack',
      targetDate: null,
      progress: { total: 2, started: 0, completed: 1 },
    },
  ],
  updates: [
    {
      id: 'u-1',
      author: { id: 'm-ann', name: 'Ann Lee' },
      health: 'at_risk',
      body: 'Movers are late.',
      createdAt: '2026-10-24T09:00:00.000Z',
    },
  ],
  issues: [issue(4, { title: 'Boxes', projectId: 'p-1' })],
  can: { edit: true, post: true },
};

describe('ProjectsPage', () => {
  it('lists projects with health in words, status and progress', async () => {
    mockApi({ 'GET /api/projects': () => ({ json: [SUMMARY] }) });
    await renderWithI18n(<ProjectsPage />);
    const row = await screen.findByRole('link', { name: /Office move/ });
    expect(row).toHaveAttribute('href', '/projects/p-1');
    expect(within(row).getByText('At risk')).toBeInTheDocument();
    expect(within(row).getByText('In progress')).toBeInTheDocument();
    expect(within(row).getByText('75%')).toBeInTheDocument();
  });

  it('creates a project for the chosen teams and opens it', async () => {
    const calls = mockApi({
      'GET /api/projects': () => ({ json: [] }),
      'GET /api/teams': () => ({
        json: [{ id: TEAM.id, key: 'HELP', name: 'Helpdesk', department: 'IT' }],
      }),
      'GET /api/directory': () => ({
        json: { members: [{ id: 'm-ann', name: 'Ann Lee' }], departments: [], roles: [] },
      }),
      'POST /api/projects': () => ({ status: 201, json: DETAIL }),
    });
    await renderWithI18n(<ProjectsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New project' }));
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    await userEvent.type(within(dialog).getByLabelText('Project name'), 'Office move');
    expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeDisabled();
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'IT / Helpdesk' }));
    await userEvent.selectOptions(within(dialog).getByLabelText('Lead'), 'm-ann');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(window.location.pathname).toBe('/projects/p-1'));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Office move',
      status: 'planned',
      teamIds: [TEAM.id],
      leadId: 'm-ann',
      memberIds: ['m-ann'],
      targetDate: null,
    });
  });
});

describe('ProjectPage', () => {
  it('shows milestones, updates and issues, and posts an update', async () => {
    const calls = mockApi({
      'GET /api/projects/p-1': () => ({ json: DETAIL }),
      'GET /api/directory': () => ({ json: { members: [], departments: [], roles: [] } }),
      'POST /api/projects/p-1/updates': () => ({ json: DETAIL }),
    });
    await renderWithI18n(<ProjectPage projectId="p-1" />, 'ru');
    expect(await screen.findByDisplayValue('Office move')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Вехи' })).getByText('Pack'),
    ).toBeInTheDocument();
    expect(screen.getByText('Movers are late.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /HELP-4/ })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Обновление статуса'), 'All boxes packed');
    await userEvent.selectOptions(screen.getByLabelText('Состояние'), 'on_track');
    await userEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      health: 'on_track',
      body: 'All boxes packed',
    });
  });
});

describe('ProjectPicker', () => {
  it('sets a project and then one of its milestones', async () => {
    const onChange = vi.fn();
    const { rerender } = await renderWithI18n(
      <ProjectPicker
        team={TEAM}
        projectId={null}
        milestoneId={null}
        className=""
        onChange={onChange}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText('Project'), 'p-1');
    expect(onChange).toHaveBeenLastCalledWith({ projectId: 'p-1', milestoneId: null });
    rerender(
      <ProjectPicker
        team={TEAM}
        projectId="p-1"
        milestoneId={null}
        className=""
        onChange={onChange}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText('Milestone'), 'ms-1');
    expect(onChange).toHaveBeenLastCalledWith({ milestoneId: 'ms-1' });
  });

  it('filters issues by project', () => {
    const issues = [issue(1, { projectId: 'p-1' }), issue(2)];
    expect(applyFilters(issues, { project: 'p-1' }).map((i) => i.number)).toEqual([1]);
    expect(applyFilters(issues, { project: 'none' }).map((i) => i.number)).toEqual([2]);
  });
});
