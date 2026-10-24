import type { RequestSlaView } from '@ordler/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '../test/render.js';
import { relativeDue, SlaBadgeChip, SlaClocks } from './Sla.js';

const NOW = Date.parse('2026-10-26T09:00:00Z');

describe('SLA display', () => {
  it('phrases due times relative to now', () => {
    expect(relativeDue('en', '2026-10-26T09:45:00Z', NOW)).toBe('in 45 minutes');
    expect(relativeDue('en', '2026-10-26T12:00:00Z', NOW)).toBe('in 3 hours');
    expect(relativeDue('en', '2026-10-29T09:00:00Z', NOW)).toBe('in 3 days');
  });

  it('shows both clocks with their state in words', async () => {
    const sla: RequestSlaView = {
      policy: { id: 'p', name: 'Standard' },
      firstResponse: {
        state: 'met',
        targetMinutes: 60,
        elapsedMinutes: 20,
        dueAt: null,
        completedAt: '2026-10-26T09:20:00Z',
      },
      resolution: {
        state: 'paused',
        targetMinutes: 480,
        elapsedMinutes: 90,
        dueAt: null,
        completedAt: null,
      },
    };
    await renderWithI18n(<SlaClocks sla={sla} />);
    expect(screen.getByText('First response')).toBeInTheDocument();
    expect(screen.getByText('Met')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('shows queue badges only for running clocks', async () => {
    const { unmount } = await renderWithI18n(
      <SlaBadgeChip badge={{ metric: 'resolution', state: 'breached', dueAt: null }} />,
    );
    expect(screen.getByText('Breached')).toBeInTheDocument();
    unmount();
    await renderWithI18n(
      <SlaBadgeChip badge={{ metric: 'resolution', state: 'met', dueAt: null }} />,
    );
    expect(screen.queryByText('Met')).not.toBeInTheDocument();
  });
});
