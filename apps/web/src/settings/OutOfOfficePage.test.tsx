import type { DelegationView } from '@ordler/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { OutOfOfficePage } from './OutOfOfficePage.js';

afterEach(() => vi.unstubAllGlobals());

const DIRECTORY = {
  members: [
    { id: 'me', name: 'Ann Lee' },
    { id: 'm2', name: 'Bob Stand' },
  ],
  departments: [],
  roles: [],
};

const DELEGATION: DelegationView = {
  id: 'd1',
  delegate: { id: 'm2', name: 'Bob Stand' },
  startsOn: '2026-11-02',
  endsOn: '2026-11-06',
  active: true,
};

describe('OutOfOfficePage', () => {
  it('adds a delegate for a date range, never offering yourself', async () => {
    const calls = mockApi({
      'GET /api/me/delegations': () => ({ json: [] }),
      'GET /api/directory': () => ({ json: DIRECTORY }),
      'POST /api/me/delegations': () => ({ status: 201, json: [DELEGATION] }),
    });
    await renderWithI18n(<OutOfOfficePage memberId="me" />);
    expect(await screen.findByText('No delegation planned.')).toBeInTheDocument();
    const select = screen.getByLabelText('Delegate');
    await waitFor(() => expect(select).toHaveValue('m2'));
    expect(screen.queryByRole('option', { name: 'Ann Lee' })).not.toBeInTheDocument();
    const from = screen.getByLabelText('From');
    await userEvent.clear(from);
    await userEvent.type(from, '2026-11-02');
    await userEvent.type(screen.getByLabelText('To'), '2026-11-06');
    await userEvent.click(screen.getByRole('button', { name: 'Add delegate' }));
    expect(await screen.findByText('Active now')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      delegateId: 'm2',
      startsOn: '2026-11-02',
      endsOn: '2026-11-06',
    });
  });

  it('explains an overlap and removes a delegation', async () => {
    let list = [DELEGATION];
    const calls = mockApi({
      'GET /api/me/delegations': () => ({ json: list }),
      'GET /api/directory': () => ({ json: DIRECTORY }),
      'POST /api/me/delegations': () => ({ status: 409, json: { error: 'delegation_overlap' } }),
      'DELETE /api/me/delegations/d1': () => {
        list = [];
        return { status: 204 };
      },
    });
    await renderWithI18n(<OutOfOfficePage memberId="me" />);
    await screen.findByText('Bob Stand', { selector: 'span' });
    await userEvent.type(screen.getByLabelText('To'), '2026-11-04');
    await userEvent.click(screen.getByRole('button', { name: 'Add delegate' }));
    expect(await screen.findByText(/already have a delegate/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('No delegation planned.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });
});
