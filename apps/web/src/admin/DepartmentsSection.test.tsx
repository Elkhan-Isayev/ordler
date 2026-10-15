import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { DepartmentsSection } from './DepartmentsSection.js';
import { DEPARTMENTS, DEPT_ID, TEAM_ID } from './fixtures.js';

afterEach(() => vi.unstubAllGlobals());

describe('DepartmentsSection', () => {
  it('lists departments with their teams', async () => {
    mockApi({ 'GET /api/admin/departments': () => ({ json: DEPARTMENTS }) });
    await renderWithI18n(<DepartmentsSection />);
    expect(await screen.findByRole('heading', { name: 'IT' })).toBeInTheDocument();
    expect(screen.getByText('HELP')).toBeInTheDocument();
    expect(screen.getByText('2 members')).toBeInTheDocument();
  });

  it('creates a department and a team with an upper-cased key', async () => {
    const calls = mockApi({
      'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
      'POST /api/admin/departments': () => ({ status: 201, json: { id: 'd2' } }),
      [`POST /api/admin/departments/${DEPT_ID}/teams`]: () => ({ status: 201, json: { id: 't2' } }),
    });
    await renderWithI18n(<DepartmentsSection />);
    const newDept = await screen.findByRole('form', { name: 'New department' });
    await userEvent.type(within(newDept).getByLabelText('Name'), 'Finance');
    await userEvent.click(within(newDept).getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/admin/departments')).toBe(
        true,
      ),
    );
    expect(
      calls.find((c) => c.path === '/api/admin/departments' && c.method === 'POST')!.body,
    ).toEqual({ name: 'Finance' });

    const addTeam = screen.getByRole('form', { name: 'Add team: IT' });
    await userEvent.type(within(addTeam).getByLabelText('Team name'), 'Infrastructure');
    await userEvent.type(within(addTeam).getByLabelText('Key'), 'infra');
    await userEvent.click(within(addTeam).getByRole('button', { name: 'Add team' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/teams'))?.body).toEqual({
        name: 'Infrastructure',
        key: 'INFRA',
        isPrivate: false,
      }),
    );
  });

  it('shows translated server errors', async () => {
    mockApi({
      'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
      [`POST /api/admin/departments/${DEPT_ID}/teams`]: () => ({
        status: 409,
        json: { error: 'team_key_taken' },
      }),
    });
    await renderWithI18n(<DepartmentsSection />, 'ru');
    const addTeam = await screen.findByRole('form', { name: 'Добавить команду: IT' });
    await userEvent.type(within(addTeam).getByLabelText('Название команды'), 'Copy');
    await userEvent.type(within(addTeam).getByLabelText('Ключ'), 'HELP');
    await userEvent.click(within(addTeam).getByRole('button', { name: 'Добавить команду' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Этот ключ уже занят другой командой.',
    );
  });

  it('archives only after confirmation', async () => {
    const calls = mockApi({
      'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
      [`POST /api/admin/teams/${TEAM_ID}/archive`]: () => ({ status: 204 }),
    });
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    await renderWithI18n(<DepartmentsSection />);
    await screen.findByText('Helpdesk');
    const archiveButtons = screen.getAllByRole('button', { name: 'Archive' });
    await userEvent.click(archiveButtons[1]!);
    expect(calls.some((c) => c.path.endsWith('/archive'))).toBe(false);
    await userEvent.click(archiveButtons[1]!);
    await waitFor(() =>
      expect(calls.some((c) => c.path === `/api/admin/teams/${TEAM_ID}/archive`)).toBe(true),
    );
    expect(confirm).toHaveBeenCalledWith(
      'Archive Helpdesk? It stays in history but can no longer be used.',
    );
  });

  it('explains an empty organization', async () => {
    mockApi({ 'GET /api/admin/departments': () => ({ json: [] }) });
    await renderWithI18n(<DepartmentsSection />);
    expect(
      await screen.findByText('No departments yet. Create the first one.'),
    ).toBeInTheDocument();
  });
});
