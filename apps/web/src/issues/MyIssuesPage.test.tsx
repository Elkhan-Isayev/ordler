import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { issue } from './fixtures.js';
import { MyIssuesPage } from './MyIssuesPage.js';

afterEach(() => vi.unstubAllGlobals());

describe('MyIssuesPage', () => {
  it('groups my issues by status category across teams', async () => {
    mockApi({
      'GET /api/me/issues': () => ({
        json: [issue(1, { statusId: 's-progress' }), issue(2), issue(3, { statusId: 's-done' })],
      }),
    });
    await renderWithI18n(<MyIssuesPage />);
    const started = await screen.findByRole('region', { name: 'In progress' });
    expect(within(started).getByText('Issue 1')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Not started' })).getByText('Issue 2'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Completed' })).getByText('Issue 3'),
    ).toBeInTheDocument();
  });

  it('says when nothing is assigned', async () => {
    mockApi({ 'GET /api/me/issues': () => ({ json: [] }) });
    await renderWithI18n(<MyIssuesPage />);
    expect(await screen.findByText('No issues yet.')).toBeInTheDocument();
  });
});
