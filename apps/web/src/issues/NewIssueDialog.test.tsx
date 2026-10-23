import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test/render.js';
import { issue, TEAM } from './fixtures.js';
import { NewIssueDialog } from './NewIssueDialog.js';

describe('NewIssueDialog', () => {
  it('creates an issue with every property set in the dialog', async () => {
    const onCreate = vi.fn(async () => ({}));
    const onClose = vi.fn();
    await renderWithI18n(
      <NewIssueDialog
        team={TEAM}
        parentIssues={[issue(1, { title: 'Office move' })]}
        onCreate={onCreate}
        onClose={onClose}
      />,
    );
    await userEvent.type(screen.getByLabelText('Issue title'), 'Pack monitors');
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'high');
    await userEvent.selectOptions(screen.getByLabelText('Assignee'), 'm-bob');
    await userEvent.click(screen.getByText('No labels'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bug' }));
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-11-01' } });
    await userEvent.selectOptions(screen.getByLabelText('Parent issue'), 'i1');
    await userEvent.click(screen.getByRole('button', { name: 'Create issue' }));
    expect(onCreate).toHaveBeenCalledWith({
      title: 'Pack monitors',
      description: '',
      statusId: 's-todo',
      priority: 'high',
      assigneeId: 'm-bob',
      labelIds: ['l-bug'],
      dueDate: '2026-11-01',
      parentId: 'i1',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the dialog open with "Create more" and submits on Ctrl+Enter', async () => {
    const onCreate = vi.fn(async () => ({ identifier: 'HELP-9' }));
    const onClose = vi.fn();
    await renderWithI18n(<NewIssueDialog team={TEAM} onCreate={onCreate} onClose={onClose} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Keep open for the next issue' }));
    const title = screen.getByLabelText('Issue title');
    await userEvent.type(title, 'First');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(title).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('HELP-9 created. Add the next one.');
    expect(screen.getByRole('button', { name: 'Create issue' })).toBeDisabled();
    // No parent chooser when there is nothing to nest under.
    expect(screen.queryByLabelText('Parent issue')).not.toBeInTheDocument();
  });
});
