import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { ANN, DEPARTMENTS, OWNER_MEMBER, ROLES, TEAM_ID } from './fixtures.js';
import { MembersSection } from './MembersSection.js';

afterEach(() => vi.unstubAllGlobals());

const base = {
  'GET /api/admin/members': () => ({ json: [OWNER_MEMBER, ANN] }),
  'GET /api/admin/roles': () => ({ json: ROLES }),
  'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
};

describe('MembersSection', () => {
  it('lists members with translated roles and scopes', async () => {
    mockApi(base);
    await renderWithI18n(<MembersSection currentMemberId="m1" />);
    expect(await screen.findByText('Ann Lee')).toBeInTheDocument();
    expect(screen.getByText(/Team lead · IT \/ Helpdesk/)).toBeInTheDocument();
    expect(screen.getByText('(you)')).toBeInTheDocument();
  });

  it('invites with a role and shows the link to share', async () => {
    const calls = mockApi({
      ...base,
      'POST /api/admin/members': () => ({
        status: 201,
        json: {
          member: {
            ...ANN,
            id: 'm-new',
            email: 'new@push30.test',
            status: 'invited',
            roles: [],
            teamIds: [],
          },
          inviteUrl: 'https://ordler.test/invite/abc',
          emailed: false,
        },
      }),
    });
    await renderWithI18n(<MembersSection currentMemberId="m1" />);
    const form = await screen.findByRole('form', { name: 'Invite member' });
    await userEvent.type(within(form).getByLabelText('Email'), 'new@push30.test');
    await userEvent.type(within(form).getByLabelText('Name'), 'New Person');
    await userEvent.selectOptions(within(form).getByLabelText('Role'), 'r-member');
    await userEvent.selectOptions(within(form).getByLabelText('Where'), `team:${TEAM_ID}`);
    await userEvent.click(within(form).getByRole('button', { name: 'Send invite' }));

    expect(await screen.findByDisplayValue('https://ordler.test/invite/abc')).toBeInTheDocument();
    expect(screen.getByText(/Mail is not configured/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      email: 'new@push30.test',
      name: 'New Person',
      role: { roleId: 'r-member', scope: { type: 'team', id: TEAM_ID } },
      teamIds: [TEAM_ID],
    });
  });

  it('invites without team membership when the role is not team-scoped', async () => {
    const calls = mockApi({
      ...base,
      'POST /api/admin/members': () => ({
        status: 201,
        json: {
          member: { ...ANN, id: 'm-x' },
          inviteUrl: 'https://ordler.test/invite/x',
          emailed: true,
        },
      }),
    });
    await renderWithI18n(<MembersSection currentMemberId="m1" />);
    const form = await screen.findByRole('form', { name: 'Invite member' });
    await userEvent.type(within(form).getByLabelText('Email'), 'x@push30.test');
    await userEvent.type(within(form).getByLabelText('Name'), 'X');
    await userEvent.selectOptions(within(form).getByLabelText('Role'), 'r-member');
    await userEvent.click(within(form).getByRole('button', { name: 'Send invite' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeDefined());
    expect(calls.find((c) => c.method === 'POST')!.body).not.toHaveProperty('teamIds');
    expect(await screen.findByText('An email with this link was sent.')).toBeInTheDocument();
  });

  it('removes and adds roles', async () => {
    const calls = mockApi({
      ...base,
      'DELETE /api/admin/members/m-ann/roles/a-1': () => ({ json: { ...ANN, roles: [] } }),
      'POST /api/admin/members/m-ann/roles': () => ({ json: ANN }),
    });
    await renderWithI18n(<MembersSection currentMemberId="m1" />);
    await userEvent.click(await screen.findByRole('button', { name: /Remove role Team lead/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));

    await userEvent.selectOptions(screen.getByLabelText('Role: Ann Lee'), 'r-member');
    await userEvent.click(screen.getAllByRole('button', { name: 'Add role' })[1]!);
    await waitFor(() =>
      expect(
        calls.find((c) => c.path === '/api/admin/members/m-ann/roles' && c.method === 'POST')?.body,
      ).toEqual({
        roleId: 'r-member',
        scope: { type: 'organization' },
      }),
    );
  });

  it('deactivates others but never offers it for yourself', async () => {
    const calls = mockApi({
      ...base,
      'PATCH /api/admin/members/m-ann': () => ({ json: { ...ANN, status: 'deactivated' } }),
    });
    await renderWithI18n(<MembersSection currentMemberId="m1" />);
    const buttons = await screen.findAllByRole('button', { name: 'Deactivate' });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'deactivated' }),
    );
  });

  it('shows the last-owner protection message', async () => {
    mockApi({
      ...base,
      'DELETE /api/admin/members/m-ann/roles/a-1': () => ({
        status: 409,
        json: { error: 'last_owner' },
      }),
    });
    await renderWithI18n(<MembersSection currentMemberId="m1" />);
    await userEvent.click(await screen.findByRole('button', { name: /Remove role/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The organization must keep at least one active Owner.',
    );
  });
});
