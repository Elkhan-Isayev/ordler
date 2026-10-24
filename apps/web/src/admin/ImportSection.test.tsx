import type { ImportOptions, ImportRunView } from '@ordler/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { DEPARTMENTS, TEAM_ID } from './fixtures.js';
import { ImportSection } from './ImportSection.js';

afterEach(() => vi.unstubAllGlobals());

const RUN: ImportRunView = {
  id: 'run-1',
  source: 'linear',
  baseUrl: null,
  account: { name: 'Linear Admin', email: null },
  status: 'draft',
  config: null,
  counts: { imported: 0, updated: 0, skipped: 0, failed: 0, comments: 0, attachments: 0 },
  report: [],
  error: null,
  createdAt: '2026-10-24T10:00:00Z',
  startedAt: null,
  finishedAt: null,
};

const OPTIONS: ImportOptions = {
  containers: [
    {
      id: 'lin-team',
      key: 'ENG',
      name: 'Engineering',
      statuses: [{ name: 'Todo', category: 'unstarted' }],
    },
  ],
  people: [{ id: 'dev@x.test', name: 'Dev', email: 'dev@x.test', suggestedMemberId: 'm2' }],
};

const DIRECTORY = { members: [{ id: 'm2', name: 'Dev Person' }], departments: [], roles: [] };

describe('ImportSection', () => {
  it('connects with a token and explains a rejected one', async () => {
    let attempts = 0;
    const calls = mockApi({
      'GET /api/admin/imports': () => ({ json: [] }),
      'POST /api/admin/imports': () =>
        ++attempts === 1
          ? { status: 422, json: { error: 'import_auth_failed' } }
          : { status: 201, json: RUN },
      'GET /api/admin/imports/run-1/options': () => ({ json: OPTIONS }),
      'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
      'GET /api/directory': () => ({ json: DIRECTORY }),
    });
    await renderWithI18n(<ImportSection />);
    await userEvent.type(await screen.findByLabelText('Linear API key'), 'lin_api_secret_1');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText(/rejected the token/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Connected to Linear as Linear Admin.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      source: 'linear',
      token: 'lin_api_secret_1',
    });
  });

  it('asks Jira Cloud for the site and email', async () => {
    const calls = mockApi({
      'GET /api/admin/imports': () => ({ json: [] }),
      'POST /api/admin/imports': () => ({ status: 201, json: { ...RUN, source: 'jira' } }),
      'GET /api/admin/imports/run-1/options': () => ({ json: OPTIONS }),
      'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
      'GET /api/directory': () => ({ json: DIRECTORY }),
    });
    await renderWithI18n(<ImportSection />);
    await userEvent.click(await screen.findByLabelText('Jira'));
    await userEvent.type(screen.getByLabelText('Jira site address'), 'https://acme.atlassian.net');
    await userEvent.type(screen.getByLabelText(/Account email/), 'me@acme.test');
    await userEvent.type(screen.getByLabelText('Jira API token'), 'jira_token_123');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        source: 'jira',
        baseUrl: 'https://acme.atlassian.net',
        email: 'me@acme.test',
        token: 'jira_token_123',
      }),
    );
  });

  it('maps teams and people, dry-runs and starts', async () => {
    const calls = mockApi({
      'GET /api/admin/imports': () => ({ json: [RUN] }),
      'GET /api/admin/imports/run-1/options': () => ({ json: OPTIONS }),
      'GET /api/admin/imports/run-1/options?containers=lin-team': () => ({ json: OPTIONS }),
      'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
      'GET /api/directory': () => ({ json: DIRECTORY }),
      'GET /api/teams/HELP': () => ({ json: { statuses: [] } }),
      'PUT /api/admin/imports/run-1/config': () => ({ json: RUN }),
      'POST /api/admin/imports/run-1/dry-run': () => ({
        json: {
          containers: [
            {
              externalId: 'lin-team',
              name: 'Engineering',
              issues: 12,
              comments: 3,
              attachments: 1,
            },
          ],
          unmappedPeople: ['Ghost'],
          oversizeAttachments: 0,
          warnings: ['estimate'],
        },
      }),
      'POST /api/admin/imports/run-1/start': () => ({
        status: 201,
        json: { ...RUN, status: 'running', startedAt: '2026-10-24T10:01:00Z' },
      }),
    });
    await renderWithI18n(<ImportSection />);
    await userEvent.click(await screen.findByRole('button', { name: /Linear Admin/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Engineering/ }));
    // The suggested member is preselected.
    expect(screen.getByLabelText('Ordler member for Dev')).toHaveValue('m2');
    await userEvent.click(screen.getByRole('button', { name: 'Dry run' }));
    expect(
      await screen.findByText('Engineering: 12 issues, 3 comments, 1 files'),
    ).toBeInTheDocument();
    expect(screen.getByText('Not mapped to anyone: Ghost')).toBeInTheDocument();
    expect(screen.getByText('Estimates are not imported yet.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      containers: [{ externalId: 'lin-team', teamId: TEAM_ID }],
      statusMap: {},
      peopleMap: { 'dev@x.test': 'm2' },
      includeClosed: true,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Start import' }));
    expect(await screen.findByText('Running')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('shows the result and notes of a finished import', async () => {
    mockApi({
      'GET /api/admin/imports': () => ({
        json: [
          {
            ...RUN,
            status: 'completed',
            startedAt: '2026-10-24T10:01:00Z',
            counts: { ...RUN.counts, imported: 2, failed: 1 },
            report: [
              { key: 'ENG-1', outcome: 'imported', identifier: 'HELP-1' },
              { key: 'ENG-2', outcome: 'failed', reason: 'boom' },
              {
                key: 'ENG-3',
                outcome: 'imported',
                identifier: 'HELP-2',
                reason: 'not_imported:estimate',
              },
            ],
          },
        ],
      }),
    });
    await renderWithI18n(<ImportSection />);
    await userEvent.click(await screen.findByRole('button', { name: /Linear Admin/ }));
    expect(screen.getByText(/2 imported, 0 updated, 0 unchanged, 1 failed/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('2 notes'));
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByText('Not imported: estimate')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
  });
});
