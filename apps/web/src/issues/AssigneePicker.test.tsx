import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test/render.js';
import { AssigneePicker, assigneePatch } from './AssigneePicker.js';
import { issue, TEAM } from './fixtures.js';
import { applyPatch } from './useTeamIssues.js';

const MULTI = { ...TEAM, settings: { multipleAssignees: true } };
const ANN = { id: 'm-ann', name: 'Ann Lee' };

describe('AssigneePicker', () => {
  it('is a single select by default', async () => {
    const onChange = vi.fn();
    await renderWithI18n(<AssigneePicker team={TEAM} value={[ANN]} editable onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText('Assignee'), 'm-bob');
    expect(onChange).toHaveBeenCalledWith(['m-bob']);
    await userEvent.selectOptions(screen.getByLabelText('Assignee'), '');
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('offers checkboxes when the team allows several', async () => {
    const onChange = vi.fn();
    await renderWithI18n(
      <AssigneePicker team={MULTI} value={[ANN]} editable onChange={onChange} />,
    );
    await userEvent.click(screen.getByText('Edit assignees'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bob Stone' }));
    expect(onChange).toHaveBeenCalledWith(['m-ann', 'm-bob']);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ann Lee' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('builds the request body the team expects', () => {
    expect(assigneePatch(TEAM, ['m-ann'])).toEqual({ assigneeId: 'm-ann' });
    expect(assigneePatch(TEAM, [])).toEqual({ assigneeId: null });
    expect(assigneePatch(MULTI, ['m-ann', 'm-bob'])).toEqual({ assigneeIds: ['m-ann', 'm-bob'] });
  });
});

describe('applyPatch with assignees', () => {
  it('updates the list and the first assignee optimistically', () => {
    const next = applyPatch(issue(1), { assigneeIds: ['m-bob', 'm-ann'] }, MULTI);
    expect(next.assignees.map((a) => a.name)).toEqual(['Bob Stone', 'Ann Lee']);
    expect(next.assignee?.name).toBe('Bob Stone');
    expect(applyPatch(next, { assigneeId: null }, TEAM).assignees).toEqual([]);
  });
});
