import type { WorkflowStatus } from '@ordler/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { TeamGithubPanel } from './TeamGithubPanel.js';

afterEach(() => vi.unstubAllGlobals());

const statuses = [
  { id: 's-todo', key: 'todo', name: 'Todo', category: 'unstarted' },
  { id: 's-progress', key: 'in_progress', name: 'In Progress', category: 'started' },
  { id: 's-done', key: 'done', name: 'Done', category: 'completed' },
] as WorkflowStatus[];

describe('TeamGithubPanel', () => {
  it('is off by default and saves the status for opened pull requests', async () => {
    const calls = mockApi({
      'GET /api/teams/HELP/github': () => ({
        json: { openedStatusId: null, mergedStatusId: null },
      }),
      'PUT /api/teams/HELP/github': () => ({
        json: { openedStatusId: 's-progress', mergedStatusId: null },
      }),
    });
    await renderWithI18n(<TeamGithubPanel team={{ key: 'HELP', statuses }} />);
    const opened = await screen.findByLabelText('When a pull request opens');
    expect(opened).toHaveValue('');
    expect(screen.getByLabelText('When a pull request merges')).toHaveValue('');
    await userEvent.selectOptions(opened, 's-progress');
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        openedStatusId: 's-progress',
        mergedStatusId: null,
      }),
    );
  });

  it('shows why saving failed', async () => {
    mockApi({
      'GET /api/teams/HELP/github': () => ({
        json: { openedStatusId: null, mergedStatusId: null },
      }),
      'PUT /api/teams/HELP/github': () => ({ status: 403, json: { error: 'forbidden' } }),
    });
    await renderWithI18n(<TeamGithubPanel team={{ key: 'HELP', statuses }} />);
    await userEvent.selectOptions(
      await screen.findByLabelText('When a pull request merges'),
      's-done',
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
