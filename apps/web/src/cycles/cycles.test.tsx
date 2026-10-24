import type { CycleDetail, TeamCycles } from '@ordler/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issue, TEAM } from '../issues/fixtures.js';
import { applyFilters } from '../issues/filters.js';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { BurnupChart } from './BurnupChart.js';
import { CyclePage, CyclesPage } from './CyclePages.js';
import { CycleSettingsPanel } from './CycleSettingsPanel.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const SETTINGS = { enabled: true, weeks: 2, startDay: 1, cooldownWeeks: 0, upcoming: 2 };
const view = (id: string, number: number, state: 'past' | 'current' | 'upcoming') => ({
  id,
  number,
  name: null,
  startsOn: '2026-10-19',
  endsOn: '2026-11-01',
  state,
  progress: { total: 4, started: 1, completed: 2 },
});
const CYCLES: TeamCycles = {
  settings: SETTINGS,
  cycles: [view('c-0', 0, 'past'), view('c-1', 1, 'current'), view('c-2', 2, 'upcoming')],
};

describe('CyclesPage', () => {
  it('groups cycles with their progress', async () => {
    mockApi({ 'GET /api/teams/HELP/cycles': () => ({ json: CYCLES }) });
    await renderWithI18n(<CyclesPage teamKey="HELP" />);
    const current = await screen.findByRole('region', { name: 'Current' });
    expect(within(current).getByRole('link', { name: /Cycle 1/ })).toHaveAttribute(
      'href',
      '/cycles/c-1',
    );
    expect(within(current).getByText('2 of 4 done · 50%')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Past' })).toBeInTheDocument();
  });

  it('opens the current cycle directly and explains when cycles are off', async () => {
    mockApi({ 'GET /api/teams/HELP/cycles': () => ({ json: CYCLES }) });
    await renderWithI18n(<CyclesPage teamKey="HELP" filter="current" />);
    await waitFor(() => expect(window.location.pathname).toBe('/cycles/c-1'));

    mockApi({
      'GET /api/teams/HELP/cycles': () => ({
        json: { settings: { ...SETTINGS, enabled: false }, cycles: [] },
      }),
    });
    await renderWithI18n(<CyclesPage teamKey="HELP" />, 'ru');
    expect(await screen.findByText(/Циклы для этой команды выключены/)).toBeInTheDocument();
  });
});

describe('CyclePage', () => {
  it('shows dates, burn-up, scope change and the cycle issues', async () => {
    const detail: CycleDetail = {
      ...view('c-1', 1, 'current'),
      team: { id: TEAM.id, key: 'HELP', name: 'Helpdesk' },
      issues: [issue(4, { title: 'Ship it', cycleId: 'c-1' })],
      burnup: [
        { date: '2026-10-19', scope: 2, completed: 0 },
        { date: '2026-10-20', scope: 3, completed: 1 },
      ],
      addedAfterStart: 1,
    };
    mockApi({ 'GET /api/cycles/c-1': () => ({ json: detail }) });
    await renderWithI18n(<CyclePage cycleId="c-1" />);
    expect(await screen.findByRole('heading', { name: 'Cycle 1' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Burn-up: 1 of 3 issues completed' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 issue was added after the cycle started.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /HELP-4/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open on the board' })).toHaveAttribute(
      'href',
      '/teams/HELP/board?cycle=c-1',
    );
  });
});

describe('BurnupChart', () => {
  it('shows both values for the day under the pointer and offers a table', async () => {
    await renderWithI18n(
      <BurnupChart
        language="en"
        points={[
          { date: '2026-10-19', scope: 2, completed: 0 },
          { date: '2026-10-20', scope: 3, completed: 1 },
        ]}
      />,
    );
    const chart = screen.getByRole('img');
    chart.getBoundingClientRect = () => ({ left: 0, width: 640, top: 0, height: 200 }) as DOMRect;
    fireEvent.mouseMove(chart, { clientX: 560 });
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Oct 20');
    expect(tip).toHaveTextContent('3Scope');
    expect(tip).toHaveTextContent('1Completed');
    await userEvent.click(screen.getByText('Show as table'));
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
});

describe('cycle filter', () => {
  it('keeps issues of one cycle or outside any', () => {
    const issues = [issue(1, { cycleId: 'c-1' }), issue(2)];
    expect(applyFilters(issues, { cycle: 'c-1' }).map((i) => i.number)).toEqual([1]);
    expect(applyFilters(issues, { cycle: 'none' }).map((i) => i.number)).toEqual([2]);
  });
});

describe('CycleSettingsPanel', () => {
  it('turns cycles on with the chosen length and start day', async () => {
    const calls = mockApi({
      'GET /api/teams/HELP/cycles': () => ({
        json: { settings: { ...SETTINGS, enabled: false }, cycles: [] },
      }),
      'PUT /api/teams/HELP/cycle-settings': (body) => ({ json: { settings: body, cycles: [] } }),
    });
    await renderWithI18n(<CycleSettingsPanel teamKey="HELP" />);
    await userEvent.click(await screen.findByLabelText('Plan cycles for this team'));
    await userEvent.selectOptions(screen.getByLabelText('Length'), '1');
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
        enabled: true,
        weeks: 1,
        startDay: 3,
        cooldownWeeks: 0,
        upcoming: 2,
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });
});
