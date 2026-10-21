import type { AuditEntryView } from '@ordler/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { AuditSection } from './AuditSection.js';

afterEach(() => vi.unstubAllGlobals());

function entry(id: string, overrides: Partial<AuditEntryView> = {}): AuditEntryView {
  return {
    id,
    actor: { type: 'member', id: 'm1', name: 'Ann Lee' },
    action: 'role.updated',
    targetType: 'role',
    targetId: '01a13d37-d040-7000-b257-0000000000r1',
    before: { name: 'Auditor' },
    after: { name: 'Auditors' },
    ip: '10.0.0.5',
    createdAt: '2026-10-21T09:00:00.000Z',
    ...overrides,
  };
}

describe('AuditSection', () => {
  it('lists entries, filters them and loads older pages', async () => {
    const calls = mockApi({
      'GET /api/admin/audit': () => ({ json: { entries: [entry('e2')], next: 'e2' } }),
      'GET /api/admin/audit?before=e2': () => ({
        json: {
          entries: [
            entry('e1', {
              action: 'issue.created',
              actor: { type: 'token', id: 'm1', name: 'Ann Lee' },
            }),
          ],
          next: null,
        },
      }),
      'GET /api/admin/audit?action=approval.decided': () => ({ json: { entries: [], next: null } }),
    });
    await renderWithI18n(<AuditSection />);
    expect(await screen.findByText('role.updated')).toBeInTheDocument();
    expect(screen.getByText(/"Auditors"/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load older' }));
    expect(await screen.findByText('Ann Lee via token')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load older' })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Action'), 'approval.decided');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('No entries.')).toBeInTheDocument();
    expect(calls.at(-1)!.path).toBe('/api/admin/audit?action=approval.decided');
  });
});
