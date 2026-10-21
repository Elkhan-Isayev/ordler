import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { TEAM } from '../issues/fixtures.js';
import { request, step } from './fixtures.js';
import { RequestPage } from './RequestPage.js';

afterEach(() => vi.unstubAllGlobals());

describe('RequestPage', () => {
  it('shows the requester status, answers and approval progress without team controls', async () => {
    mockApi({ 'GET /api/requests/REQ-7': () => ({ json: request() }) });
    await renderWithI18n(<RequestPage identifier="REQ-7" />);
    expect(await screen.findByRole('heading', { name: '20 headsets' })).toBeInTheDocument();
    expect(screen.getByText('Pending approval')).toBeInTheDocument();
    expect(screen.getByText('Headset')).toBeInTheDocument();
    const approvals = screen.getByRole('region', { name: 'Approvals' });
    expect(
      within(approvals).getByText("Supervisor of the requester's department"),
    ).toBeInTheDocument();
    expect(within(approvals).getByText('Any of: Cora Boss')).toBeInTheDocument();
    expect(within(approvals).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Team actions' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Internal (team only)')).not.toBeInTheDocument();
  });

  it('lets an approver approve, and needs a comment to reject', async () => {
    const calls = mockApi({
      'GET /api/requests/REQ-7': () => ({
        json: request({ approvals: [step({ canDecide: true })] }),
      }),
      'POST /api/approvals/s1/decision': () => ({
        json: { request: request({ approvals: [step({ status: 'approved' })], status: 'open' }) },
      }),
    });
    await renderWithI18n(<RequestPage identifier="REQ-7" />);
    const approvals = await screen.findByRole('region', { name: 'Approvals' });
    expect(within(approvals).getByRole('button', { name: 'Reject' })).toBeDisabled();
    await userEvent.click(within(approvals).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByText('Open')).toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ decision: 'approve' });
  });

  it('gives the receiving team its actions and internal comments', async () => {
    const calls = mockApi({
      'GET /api/requests/REQ-7': () => ({
        json: request({
          status: 'open',
          perspective: 'agent',
          approvals: [],
          linkedIssues: { kind: 'details', items: [] },
          can: {
            act: true,
            commentPublic: true,
            commentInternal: true,
            resubmit: false,
            confirm: false,
            spawnIssue: true,
          },
        }),
      }),
      'GET /api/teams/HELP': () => ({ json: TEAM }),
      'POST /api/requests/REQ-7/actions': () => ({
        json: request({ status: 'in_progress', perspective: 'agent' }),
      }),
    });
    await renderWithI18n(<RequestPage identifier="REQ-7" />);
    const actions = await screen.findByRole('group', { name: 'Team actions' });
    expect(screen.getByLabelText('Internal (team only)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Create issue' })).toBeInTheDocument();
    await userEvent.click(within(actions).getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ action: 'accept' }),
    );
  });

  it('asks the requester to confirm a resolved request', async () => {
    const calls = mockApi({
      'GET /api/requests/REQ-7': () => ({
        json: request({
          status: 'resolved',
          approvals: [],
          can: {
            act: false,
            commentPublic: true,
            commentInternal: false,
            resubmit: false,
            confirm: true,
            spawnIssue: false,
          },
        }),
      }),
      'POST /api/requests/REQ-7/requester-actions': () => ({
        json: request({ status: 'closed', approvals: [] }),
      }),
    });
    await renderWithI18n(<RequestPage identifier="REQ-7" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, close it' }));
    await waitFor(() => expect(screen.getByText('Closed')).toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ action: 'confirm' });
  });

  it('shows requesters only the progress of internal work', async () => {
    mockApi({
      'GET /api/requests/REQ-7': () => ({
        json: request({
          status: 'in_progress',
          approvals: [],
          linkedIssues: { kind: 'progress', done: 1, total: 2 },
        }),
      }),
    });
    await renderWithI18n(<RequestPage identifier="REQ-7" />);
    expect(await screen.findByText('Work done: 1 of 2')).toBeInTheDocument();
  });
});
