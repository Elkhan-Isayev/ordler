import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '../test/render.js';
import { issue } from './fixtures.js';
import { IssueList } from './IssueList.js';

const labels = Array.from({ length: 7 }, (_, i) => ({
  id: `l-${i}`,
  name: `label-${i}`,
  color: '#e5484d',
}));

describe('IssueList', () => {
  it('shows three labels and a count for the rest, so the title keeps its room', async () => {
    await renderWithI18n(<IssueList issues={[issue(7, { labels })]} />);
    const row = screen.getByRole('link', { name: /HELP-7/ });
    expect(within(row).getByText('Issue 7')).toBeInTheDocument();
    expect(within(row).getByText('label-2')).toBeInTheDocument();
    expect(within(row).queryByText('label-3')).not.toBeInTheDocument();
    const more = within(row).getByLabelText('4 more labels');
    expect(more).toHaveTextContent('+4');
    expect(more).toHaveAttribute('title', 'label-3, label-4, label-5, label-6');
  });

  it('shows no count when every label fits', async () => {
    await renderWithI18n(<IssueList issues={[issue(7, { labels: labels.slice(0, 3) })]} />);
    expect(screen.getByText('label-2')).toBeInTheDocument();
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
  });
});
