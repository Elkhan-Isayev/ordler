import type { SearchResults } from '@ordler/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TFunction } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../i18n/index.js';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { detail, issue, TEAM } from './fixtures.js';
import { IssueBlocks } from './IssueBlocks.js';
import { describeEvent } from './IssuePage.js';
import { BlockedMark } from './ui.js';

afterEach(() => vi.unstubAllGlobals());

const search =
  (...numbers: number[]): (() => { json: SearchResults }) =>
  () => ({
    json: { issues: numbers.map((n) => issue(n)), requests: [], wikiPages: [] },
  });

describe('IssueBlocks', () => {
  it('lists both sides and removes one relation', async () => {
    const onChanged = vi.fn();
    const calls = mockApi({ 'PATCH /api/issues/HELP-7': () => ({ json: detail(7) }) });
    await renderWithI18n(
      <IssueBlocks
        issue={detail(7, { blockedBy: [issue(3), issue(4)], blocking: [issue(9)] })}
        editable
        onChanged={onChanged}
        onError={vi.fn()}
      />,
    );
    const blockedBy = screen.getByRole('list', { name: 'Blocked by' });
    expect(
      within(blockedBy)
        .getAllByRole('link')
        .map((l) => l.getAttribute('href')),
    ).toEqual(['/issue/HELP-3', '/issue/HELP-4']);
    expect(
      within(screen.getByRole('list', { name: 'Blocking' })).getByRole('link'),
    ).toHaveAttribute('href', '/issue/HELP-9');
    await userEvent.click(screen.getByRole('button', { name: 'Remove relation to HELP-3' }));
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { blockedBy: ['HELP-4'] } });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('adds a blocking issue found by search, leaving out itself and existing ones', async () => {
    const onChanged = vi.fn();
    const calls = mockApi({
      'GET /api/search?q=proj': search(7, 3, 5),
      'PATCH /api/issues/HELP-7': () => ({ json: detail(7) }),
    });
    await renderWithI18n(
      <IssueBlocks
        issue={detail(7, { blockedBy: [issue(3)] })}
        editable
        onChanged={onChanged}
        onError={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add relation' }));
    await userEvent.selectOptions(screen.getByLabelText('Relation type'), 'blocking');
    await userEvent.type(screen.getByLabelText('Search issues by ID or title'), 'proj');
    const results = await screen.findByRole('listbox', { name: 'Matching issues' });
    expect(
      within(results)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([expect.stringContaining('HELP-5')]);
    await userEvent.click(within(results).getByRole('button', { name: /HELP-5/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', body: { blocking: ['HELP-5'] } });
  });

  it('shows a translated error when the server refuses the relation', async () => {
    const onError = vi.fn();
    mockApi({
      'PATCH /api/issues/HELP-7': () => ({ status: 400, json: { error: 'invalid_relation' } }),
    });
    await renderWithI18n(
      <IssueBlocks
        issue={detail(7, { blocking: [issue(3)] })}
        editable
        onChanged={vi.fn()}
        onError={onError}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove relation to HELP-3' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('errors.invalid_relation'));
  });

  it('is read-only without edit rights and hidden when there is nothing to show', async () => {
    const { unmount } = await renderWithI18n(
      <IssueBlocks
        issue={detail(7, { blockedBy: [issue(3)] })}
        editable={false}
        onChanged={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(screen.getByRole('list', { name: 'Blocked by' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove relation/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add relation' })).not.toBeInTheDocument();
    unmount();

    await renderWithI18n(
      <IssueBlocks issue={detail(7)} editable={false} onChanged={vi.fn()} onError={vi.fn()} />,
    );
    expect(screen.queryByRole('region', { name: 'Relations' })).not.toBeInTheDocument();
  });

  it('links to the Help clip', async () => {
    await renderWithI18n(
      <IssueBlocks issue={detail(7)} editable onChanged={vi.fn()} onError={vi.fn()} />,
    );
    expect(screen.getByRole('link', { name: 'How relations work' })).toHaveAttribute(
      'href',
      '/help#issue-blocking',
    );
  });
});

describe('relation history and marks', () => {
  it('says what was added and removed', async () => {
    const t = (await createI18n('en')).t as TFunction;
    const event = (changes: object) => ({
      id: 'e',
      kind: 'updated' as const,
      actor: { id: 'm-ann', name: 'Ann Lee' },
      changes,
      viaToken: null,
      createdAt: '2026-11-26T09:00:00.000Z',
    });
    expect(describeEvent(t, event({ blockedBy: { from: ['HELP-2'], to: ['HELP-3'] } }), TEAM)).toBe(
      'Ann Lee: marked as blocked by HELP-3, no longer blocked by HELP-2',
    );
    expect(describeEvent(t, event({ blocking: { from: [], to: ['HELP-1'] } }), TEAM)).toBe(
      'Ann Lee: marked as blocking HELP-1',
    );
  });

  it('marks blocked issues with a labelled icon', async () => {
    await renderWithI18n(<BlockedMark />);
    expect(screen.getByRole('img', { name: 'Blocked' })).toBeInTheDocument();
  });
});
