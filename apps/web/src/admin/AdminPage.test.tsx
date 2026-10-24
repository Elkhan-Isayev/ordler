import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME, mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { AdminPage, adminSections } from './AdminPage.js';
import { DEPARTMENTS } from './fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('adminSections', () => {
  it('maps permissions to sections', () => {
    expect(adminSections(['org.manage', 'auth.manage'])).toEqual([
      'departments',
      'members',
      'authentication',
      'tokens',
      'import',
      'database',
      'updates',
    ]);
    expect(adminSections(['auth.manage'])).toEqual(['authentication']);
    expect(adminSections(['webhook.manage'])).toEqual(['webhooks']);
    expect(adminSections(['team.update'])).toEqual(['integrations']);
    expect(adminSections(['mail.manage'])).toEqual(['mail']);
    expect(adminSections(['issue.read'])).toEqual([]);
  });
});

describe('AdminPage', () => {
  it('opens the first allowed section and navigates between sections', async () => {
    mockApi({
      'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
      'GET /api/admin/updates': () => ({
        json: {
          enabled: true,
          currentVersion: null,
          latestVersion: null,
          updateAvailable: false,
          majorUpgrade: false,
          release: null,
          checkedAt: null,
          lastError: null,
        },
      }),
    });
    await renderWithI18n(
      <AdminPage me={{ ...ME, organizationPermissions: ['org.manage'] }} section={undefined} />,
    );
    expect(
      await screen.findByRole('heading', { name: 'Departments and teams' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign-in' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Updates' }));
    expect(window.location.pathname).toBe('/admin/updates');
  });

  it('explains when the member has no admin access', async () => {
    await renderWithI18n(
      <AdminPage me={{ ...ME, organizationPermissions: [] }} section="members" />,
    );
    expect(screen.getByText("You don't have access to administration.")).toBeInTheDocument();
  });

  it('falls back to an allowed section for unknown or forbidden ones', async () => {
    mockApi({
      'GET /api/admin/auth/strategies': () => ({ json: [] }),
      'GET /api/admin/roles': () => ({ json: [] }),
    });
    await renderWithI18n(
      <AdminPage me={{ ...ME, organizationPermissions: ['auth.manage'] }} section="members" />,
    );
    expect(await screen.findByRole('heading', { name: 'Sign-in methods' })).toBeInTheDocument();
  });
});
