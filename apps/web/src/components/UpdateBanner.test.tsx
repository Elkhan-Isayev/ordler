import type { UpdateStatusResponse } from '@ordler/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { DISMISSED_UPDATE_KEY, UpdateBanner } from './UpdateBanner.js';

const STATUS: UpdateStatusResponse = {
  enabled: true,
  currentVersion: '1.4.0',
  latestVersion: '1.5.0',
  updateAvailable: true,
  majorUpgrade: false,
  release: {
    name: 'Ordler 1.5.0',
    url: 'https://github.com/Elkhan-Isayev/ordler/releases/tag/v1.5.0',
    notes: '- Faster boards',
    publishedAt: '2026-10-12T08:00:00Z',
  },
  checkedAt: '2026-10-15T08:00:00Z',
  lastError: null,
};

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('UpdateBanner', () => {
  it('tells admins about a newer version with release notes', async () => {
    mockApi({ 'GET /api/admin/updates': () => ({ json: STATUS }) });
    await renderWithI18n(<UpdateBanner isAdmin />);
    expect(await screen.findByText('Ordler 1.5.0 is available')).toBeInTheDocument();
    expect(screen.getByText('You are running 1.4.0.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Release notes' })).toHaveAttribute(
      'href',
      STATUS.release!.url,
    );
    expect(screen.getByRole('link', { name: 'Release notes' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
  });

  it('shows update steps that keep data safe', async () => {
    mockApi({ 'GET /api/admin/updates': () => ({ json: STATUS }) });
    await renderWithI18n(<UpdateBanner isAdmin />);
    await userEvent.click(await screen.findByRole('button', { name: 'How to update' }));
    expect(screen.getByText(/Take a database backup first/)).toBeInTheDocument();
    expect(screen.getByText('docker compose pull && docker compose up -d')).toBeInTheDocument();
    expect(screen.getByText(/--set image.tag=1.5.0/)).toBeInTheDocument();
    expect(screen.getByText(/Your data stays in PostgreSQL/)).toBeInTheDocument();
  });

  it('never asks non-admins’ browsers to load update data', async () => {
    const calls = mockApi({ 'GET /api/admin/updates': () => ({ json: STATUS }) });
    const { container } = await renderWithI18n(<UpdateBanner isAdmin={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(calls).toHaveLength(0);
  });

  it('stays hidden when up to date', async () => {
    mockApi({
      'GET /api/admin/updates': () => ({ json: { ...STATUS, updateAvailable: false } }),
    });
    const { container } = await renderWithI18n(<UpdateBanner isAdmin />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('warns about major upgrades', async () => {
    mockApi({
      'GET /api/admin/updates': () => ({
        json: { ...STATUS, latestVersion: '2.0.0', majorUpgrade: true },
      }),
    });
    await renderWithI18n(<UpdateBanner isAdmin />, 'ru');
    expect(await screen.findByText(/Мажорная версия/)).toBeInTheDocument();
    expect(screen.getByText('Доступна версия Ordler 2.0.0')).toBeInTheDocument();
  });

  it('can be dismissed until a newer release appears', async () => {
    mockApi({ 'GET /api/admin/updates': () => ({ json: STATUS }) });
    const first = await renderWithI18n(<UpdateBanner isAdmin />);
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Ordler 1.5.0 is available')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(DISMISSED_UPDATE_KEY)).toBe('1.5.0');
    first.unmount();

    mockApi({ 'GET /api/admin/updates': () => ({ json: { ...STATUS, latestVersion: '1.6.0' } }) });
    await renderWithI18n(<UpdateBanner isAdmin />);
    expect(await screen.findByText('Ordler 1.6.0 is available')).toBeInTheDocument();
  });

  it('ignores API failures', async () => {
    mockApi({ 'GET /api/admin/updates': () => ({ status: 500, json: { error: 'boom' } }) });
    const { container } = await renderWithI18n(<UpdateBanner isAdmin />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
