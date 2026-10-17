import { describe, expect, it } from 'vitest';
import { issue, TEAM } from './fixtures.js';
import { applyPatch, upsertIssue } from './useTeamIssues.js';

describe('upsertIssue', () => {
  it('adds new issues and keeps column order', () => {
    const list = upsertIssue([issue(1)], issue(2));
    expect(list.map((i) => i.identifier)).toEqual(['HELP-2', 'HELP-1']);
  });

  it('ignores updates older than what is shown', () => {
    const newer = issue(1, { title: 'new', updatedAt: '2026-10-18T10:00:00.000Z' });
    const older = issue(1, { title: 'old', updatedAt: '2026-10-18T09:30:00.000Z' });
    expect(upsertIssue([newer], older)[0]!.title).toBe('new');
  });
});

describe('applyPatch', () => {
  it('updates status and assignee from the team view', () => {
    const next = applyPatch(issue(1), { statusId: 's-done', assigneeId: 'm-ann' }, TEAM);
    expect(next.status.category).toBe('completed');
    expect(next.assignee).toEqual({ id: 'm-ann', name: 'Ann Lee' });
    expect(applyPatch(next, { assigneeId: null }, TEAM).assignee).toBeNull();
  });
});
