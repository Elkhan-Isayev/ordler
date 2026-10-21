import type { AdminRole } from '@ordler/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { RolesSection } from './RolesSection.js';

afterEach(() => vi.unstubAllGlobals());

const SYSTEM: AdminRole = { id: 'r1', key: 'member', name: 'Member', permissions: ['issue.read'] };
const CUSTOM: AdminRole = { id: 'r2', key: null, name: 'Auditor', permissions: ['org.audit.read'] };

describe('RolesSection', () => {
  it('creates a custom role from checked permissions', async () => {
    let roles = [SYSTEM];
    const calls = mockApi({
      'GET /api/admin/roles': () => ({ json: roles }),
      'POST /api/admin/roles': (body) => {
        roles = [SYSTEM, CUSTOM];
        return { status: 201, json: { ...CUSTOM, ...(body as object) } };
      },
    });
    await renderWithI18n(<RolesSection />);
    expect(await screen.findByText('System role · 1 permission')).toBeInTheDocument();
    // System roles cannot be edited.
    expect(screen.queryByRole('button', { name: 'Edit Member' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('instance.manage')).not.toBeInTheDocument();

    const form = screen.getByRole('form', { name: 'New role' });
    await userEvent.type(within(form).getByLabelText('Name'), 'Auditor');
    await userEvent.click(within(form).getByLabelText('org.audit.read'));
    await userEvent.click(within(form).getByRole('button', { name: 'Create role' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Auditor',
      permissions: ['org.audit.read'],
    });
    expect(await screen.findByText('Auditor')).toBeInTheDocument();
  });

  it('edits and deletes custom roles and shows why a delete failed', async () => {
    const calls = mockApi({
      'GET /api/admin/roles': () => ({ json: [SYSTEM, CUSTOM] }),
      'PUT /api/admin/roles/r2': (body) => ({ json: { ...CUSTOM, ...(body as object) } }),
      'DELETE /api/admin/roles/r2': () => ({ status: 409, json: { error: 'role_in_use' } }),
    });
    await renderWithI18n(<RolesSection />, 'ru');
    await userEvent.click(await screen.findByRole('button', { name: 'Изменить Auditor' }));
    const form = screen.getByRole('form', { name: 'Изменить Auditor' });
    await userEvent.click(within(form).getByLabelText('issue.read'));
    await userEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      name: 'Auditor',
      permissions: ['org.audit.read', 'issue.read'],
    });

    await userEvent.click(screen.getByRole('button', { name: 'Удалить Auditor' }));
    expect(await screen.findByText(/Эта роль ещё выдана участникам/)).toBeInTheDocument();
  });
});
