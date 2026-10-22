import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test/render.js';
import { issue, TEAM } from './fixtures.js';
import { IssueContextMenu } from './IssueContextMenu.js';

afterEach(() => vi.unstubAllGlobals());

function open(overrides: Partial<typeof TEAM> = {}) {
  const onUpdate = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  const item = issue(4, { labels: [{ id: 'l-bug', name: 'Bug', color: '#e5484d' }] });
  const result = renderWithI18n(
    <IssueContextMenu
      menu={{ issue: item, x: 10, y: 10 }}
      team={{ ...TEAM, ...overrides }}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onClose={onClose}
    />,
  );
  return { item, onUpdate, onDelete, onClose, result };
}

describe('IssueContextMenu', () => {
  it('changes status, priority, assignee and labels in place', async () => {
    const { item, onUpdate, onClose, result } = open();
    await result;
    await userEvent.click(screen.getByRole('menuitem', { name: /Status/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Done' }));
    expect(onUpdate).toHaveBeenLastCalledWith(item, { statusId: 's-done' });
    expect(onClose).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('menuitem', { name: /Priority/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Urgent' }));
    expect(onUpdate).toHaveBeenLastCalledWith(item, { priority: 'urgent' });

    await userEvent.click(screen.getByRole('menuitem', { name: /Assignee/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Bob Stone/ }));
    expect(onUpdate).toHaveBeenLastCalledWith(item, { assigneeId: 'm-bob' });

    await userEvent.click(screen.getByRole('menuitem', { name: /Labels/ }));
    const labels = screen.getByRole('menu', { name: 'Labels' });
    await userEvent.click(within(labels).getByRole('menuitemcheckbox', { name: /Security/ }));
    expect(onUpdate).toHaveBeenLastCalledWith(item, { labelIds: ['l-bug', 'l-sec'] });
  });

  it('copies the link and deletes after confirmation', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const { item, onDelete, result } = open();
    await result;
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/issue/HELP-4`);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(item);
  });

  it('hides actions the member may not take', async () => {
    const { result } = open({
      can: { create: false, update: false, assign: false, comment: false, delete: false },
    });
    await result;
    expect(screen.queryByRole('menuitem', { name: /Status/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy ID' })).toBeInTheDocument();
  });
});
