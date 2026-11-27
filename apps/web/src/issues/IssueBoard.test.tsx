import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test/render.js';
import { issue, TEAM } from './fixtures.js';
import { IssueBoard } from './IssueBoard.js';

describe('IssueBoard', () => {
  it('wraps every label and a long title inside the card instead of spilling over', async () => {
    const labels = Array.from({ length: 20 }, (_, i) => ({
      id: `l-${i}`,
      name: `label-${i}`,
      color: '#e5484d',
    }));
    const title = 'Unbroken_'.repeat(30);
    await renderWithI18n(
      <IssueBoard team={TEAM} issues={[issue(7, { title, labels })]} onMove={vi.fn()} />,
    );
    // All labels stay on the card; the row wraps them onto new lines.
    expect(screen.getByText('label-19')).toBeInTheDocument();
    expect(screen.getByText('label-19').closest('div')).toHaveClass('flex-wrap');
    expect(screen.getByText(title)).toHaveClass('[overflow-wrap:anywhere]');
  });
});
