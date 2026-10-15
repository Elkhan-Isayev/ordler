import type { UpdateStatusResponse } from '@ordler/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { UpdatesSection } from './UpdatesSection.js';

afterEach(() => vi.unstubAllGlobals());

const STATUS: UpdateStatusResponse = {
  enabled: true,
  currentVersion: '1.4.0',
  latestVersion: '1.4.0',
  updateAvailable: false,
  majorUpgrade: false,
  release: null,
  checkedAt: null,
  lastError: null,
};

describe('UpdatesSection', () => {
  it('shows versions and checks on demand', async () => {
    const calls = mockApi({
      'GET /api/admin/updates': () => ({ json: STATUS }),
      'POST /api/admin/updates/check': () => ({
        json: {
          ...STATUS,
          latestVersion: '1.5.0',
          updateAvailable: true,
          checkedAt: '2026-10-15T10:00:00Z',
        },
      }),
    });
    await renderWithI18n(<UpdatesSection />);
    expect(await screen.findByText('You are up to date.')).toBeInTheDocument();
    expect(screen.getByText('never')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText('Version 1.5.0 is available.')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
  });

  it('explains disabled checks and development builds', async () => {
    mockApi({
      'GET /api/admin/updates': () => ({
        json: { ...STATUS, enabled: false, currentVersion: null },
      }),
    });
    await renderWithI18n(<UpdatesSection />);
    expect(await screen.findByText('development build')).toBeInTheDocument();
    expect(screen.getByText(/Update checks are turned off/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check now' })).not.toBeInTheDocument();
  });

  it('reports the last failed check', async () => {
    mockApi({
      'GET /api/admin/updates': () => ({ json: { ...STATUS, lastError: 'GitHub responded 403' } }),
    });
    await renderWithI18n(<UpdatesSection />);
    expect(await screen.findByText('Last check failed: GitHub responded 403')).toBeInTheDocument();
  });
});
