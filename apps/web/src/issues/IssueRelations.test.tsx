import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { detail, issue, TEAM } from './fixtures.js';
import { IssueRelations, LabelPicker, nextLabelColor } from './IssueRelations.js';

afterEach(() => vi.unstubAllGlobals());

describe('LabelPicker', () => {
  it('toggles team labels and creates a new one', async () => {
    const onSave = vi.fn(async () => undefined);
    const onTeamChanged = vi.fn();
    const calls = mockApi({
      'POST /api/labels': () => ({
        status: 201,
        json: { id: 'l-new', name: 'Docs', color: '#f76b15', scope: 'team' },
      }),
    });
    await renderWithI18n(
      <LabelPicker
        issue={detail(7, { labels: [{ id: 'l-bug', name: 'Bug', color: '#e5484d' }] })}
        team={TEAM}
        editable
        onSave={onSave}
        onTeamChanged={onTeamChanged}
        onError={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText('Edit labels'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Security' }));
    expect(onSave).toHaveBeenLastCalledWith(['l-bug', 'l-sec']);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bug' }));
    expect(onSave).toHaveBeenLastCalledWith([]);

    await userEvent.type(screen.getByLabelText('New label'), 'Docs{Enter}');
    expect(calls[0]!.body).toEqual({ teamId: TEAM.id, name: 'Docs', color: '#f76b15' });
    expect(onSave).toHaveBeenLastCalledWith(['l-bug', 'l-new']);
    expect(onTeamChanged).toHaveBeenCalled();
  });

  it('is read-only without edit rights', async () => {
    await renderWithI18n(
      <LabelPicker
        issue={detail(7)}
        team={TEAM}
        editable={false}
        onSave={vi.fn()}
        onTeamChanged={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(screen.queryByText('Edit labels')).not.toBeInTheDocument();
  });

  it('picks the first unused color', () => {
    expect(nextLabelColor(TEAM)).toBe('#f76b15');
  });
});

describe('IssueRelations', () => {
  it('lists sub-issues with progress and adds one', async () => {
    const onChanged = vi.fn();
    const calls = mockApi({
      'POST /api/teams/HELP/issues': () => ({ status: 201, json: detail(9) }),
    });
    await renderWithI18n(
      <IssueRelations
        issue={detail(7, { children: [issue(8, { statusId: 's-done', title: 'Pack' }), issue(9)] })}
        team={TEAM}
        onChanged={onChanged}
        onError={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: /Sub-issues\s*1\/2/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /HELP-8/ })).toHaveAttribute('href', '/issue/HELP-8');
    // The full new-issue dialog opens with the parent fixed, so a description can be added.
    await userEvent.click(screen.getByRole('button', { name: 'Add sub-issue' }));
    const dialog = screen.getByRole('dialog', { name: 'New issue in Helpdesk' });
    expect(within(dialog).getByText('New sub-issue of HELP-7')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Parent issue')).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Issue title'), 'Buy boxes');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create issue' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls[0]!.body).toMatchObject({ title: 'Buy boxes', parentId: 'i7' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('links to the parent and detaches from it', async () => {
    const calls = mockApi({ 'PATCH /api/issues/HELP-7': () => ({ json: detail(7) }) });
    await renderWithI18n(
      <IssueRelations
        issue={detail(7, { parent: { id: 'i1', identifier: 'HELP-1', title: 'Office move' } })}
        team={TEAM}
        onChanged={vi.fn()}
        onError={vi.fn()}
      />,
      'ru',
    );
    expect(screen.getByRole('link', { name: 'HELP-1 Office move' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Отвязать' }));
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { parentId: null } });
  });
});

describe('nested sub-issues', () => {
  it('shows the second level under its parent, like Linear', async () => {
    await renderWithI18n(
      <IssueRelations
        issue={detail(1, {
          children: [issue(2, { title: 'Sub issue 1', parentId: 'i1' })],
          grandchildren: [issue(3, { title: 'Sub sub issue', parentId: 'i2' })],
        })}
        team={TEAM}
        onChanged={vi.fn()}
        onError={vi.fn()}
      />,
    );
    const nested = screen.getByRole('list', { name: 'HELP-2' });
    expect(within(nested).getByRole('link', { name: /HELP-3/ })).toHaveAttribute(
      'href',
      '/issue/HELP-3',
    );
  });
});
