import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME, mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { AcceptInvitePage } from './AcceptInvitePage.js';

afterEach(() => vi.unstubAllGlobals());

describe('AcceptInvitePage', () => {
  it('lets the invitee set a name and password', async () => {
    const calls = mockApi({
      'GET /api/invites/tok123': () => ({
        json: { email: 'ann@push30.test', companyName: 'Push30' },
      }),
      'POST /api/invites/accept': () => ({ json: ME }),
    });
    const onAccepted = vi.fn();
    await renderWithI18n(<AcceptInvitePage token="tok123" onAccepted={onAccepted} />);
    expect(await screen.findByRole('heading', { name: 'Join Push30' })).toBeInTheDocument();
    expect(screen.getByText(/invited as ann@push30.test/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Your name'), 'Ann Lee');
    await userEvent.type(screen.getByLabelText('Password'), 'ann-password-123');
    await userEvent.type(screen.getByLabelText('Repeat password'), 'ann-password-123');
    await userEvent.click(screen.getByRole('button', { name: 'Join workspace' }));
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(ME));
    expect(calls.at(-1)!.body).toEqual({
      token: 'tok123',
      name: 'Ann Lee',
      password: 'ann-password-123',
    });
  });

  it('explains invalid or expired links', async () => {
    mockApi({ 'GET /api/invites/old': () => ({ status: 410, json: { error: 'invite_invalid' } }) });
    await renderWithI18n(<AcceptInvitePage token="old" onAccepted={vi.fn()} />, 'de');
    expect(await screen.findByText(/Einladungslink ist ungültig/)).toBeInTheDocument();
  });

  it('checks the password before calling the API', async () => {
    const calls = mockApi({
      'GET /api/invites/tok': () => ({ json: { email: 'a@b.co', companyName: 'X' } }),
    });
    await renderWithI18n(<AcceptInvitePage token="tok" onAccepted={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText('Your name'), 'A');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.type(screen.getByLabelText('Repeat password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Join workspace' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The password is too short.');
    expect(calls).toHaveLength(1);
  });
});
