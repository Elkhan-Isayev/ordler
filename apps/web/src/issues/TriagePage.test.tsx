import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { fakeRealtime } from '../test/realtime-fake.js';
import { renderWithI18n } from '../test/render.js';
import { detail, issue, TEAM } from './fixtures.js';
import { TriagePage } from './TriagePage.js';

let realtime: ReturnType<typeof fakeRealtime>;
beforeEach(() => {
  realtime = fakeRealtime();
});
afterEach(() => {
  realtime.reset();
  vi.unstubAllGlobals();
});

const pending = (n: number) => issue(n, { inTriage: true, title: `Filed ${n}` });

describe('TriagePage', () => {
  it('marks an issue as a duplicate of another', async () => {
    const calls = mockApi({
      'GET /api/teams/HELP': () => ({ json: TEAM }),
      'GET /api/teams/HELP/triage': () => ({ json: [pending(4)] }),
      'POST /api/issues/HELP-4/triage': () => ({ json: detail(4) }),
    });
    await renderWithI18n(<TriagePage teamKey="HELP" />);
    const item = await screen.findByRole('listitem', { name: 'HELP-4' });
    await userEvent.click(within(item).getByRole('button', { name: 'Duplicate' }));
    await userEvent.type(within(item).getByLabelText(/Duplicate of/), 'HELP-1');
    await userEvent.click(within(item).getByRole('button', { name: 'Mark as duplicate' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
        action: 'duplicate',
        of: 'HELP-1',
      }),
    );
  });

  it('accepts an issue into the chosen status with an assignee', async () => {
    const calls = mockApi({
      'GET /api/teams/HELP': () => ({ json: TEAM }),
      'GET /api/teams/HELP/triage': () => ({ json: [pending(4)] }),
      'POST /api/issues/HELP-4/triage': () => ({ json: detail(4) }),
    });
    await renderWithI18n(<TriagePage teamKey="HELP" />);
    const item = await screen.findByRole('listitem', { name: 'HELP-4' });
    await userEvent.selectOptions(within(item).getByLabelText('Status: HELP-4'), 's-progress');
    await userEvent.selectOptions(within(item).getByLabelText('Assignee: HELP-4'), 'm-ann');
    await userEvent.click(within(item).getByRole('button', { name: 'Accept' }));

    await waitFor(() => expect(screen.getByText('Nothing to triage.')).toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      action: 'accept',
      statusId: 's-progress',
      assigneeId: 'm-ann',
    });
  });

  it('declines with a reason', async () => {
    const calls = mockApi({
      'GET /api/teams/HELP': () => ({ json: TEAM }),
      'GET /api/teams/HELP/triage': () => ({ json: [pending(4)] }),
      'POST /api/issues/HELP-4/triage': () => ({ json: detail(4) }),
    });
    await renderWithI18n(<TriagePage teamKey="HELP" />);
    const item = await screen.findByRole('listitem', { name: 'HELP-4' });
    await userEvent.click(within(item).getByRole('button', { name: 'Decline' }));
    const decline = within(item).getByRole('button', { name: 'Decline' });
    expect(decline).toBeDisabled();
    await userEvent.type(within(item).getByLabelText('Why is it declined?'), 'Duplicate of HELP-1');
    await userEvent.click(decline);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
        action: 'decline',
        reason: 'Duplicate of HELP-1',
      }),
    );
  });

  it('follows filings and decisions made elsewhere', async () => {
    mockApi({
      'GET /api/teams/HELP': () => ({ json: TEAM }),
      'GET /api/teams/HELP/triage': () => ({ json: [pending(4)] }),
    });
    await renderWithI18n(<TriagePage teamKey="HELP" />);
    await screen.findByText('Filed 4');
    act(() => realtime.push({ type: 'issue.changed', issue: pending(5) }));
    expect(await screen.findByText('Filed 5')).toBeInTheDocument();
    act(() =>
      realtime.push({
        type: 'issue.changed',
        issue: issue(4, { inTriage: false, updatedAt: '2026-10-18T10:00:00.000Z' }),
      }),
    );
    await waitFor(() => expect(screen.queryByText('Filed 4')).not.toBeInTheDocument());
  });

  it('shows no decisions to viewers', async () => {
    mockApi({
      'GET /api/teams/HELP': () => ({
        json: { ...TEAM, can: { create: false, update: false, assign: false, comment: false } },
      }),
      'GET /api/teams/HELP/triage': () => ({ json: [pending(4)] }),
    });
    await renderWithI18n(<TriagePage teamKey="HELP" />);
    const item = await screen.findByRole('listitem', { name: 'HELP-4' });
    expect(within(item).queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });
});
