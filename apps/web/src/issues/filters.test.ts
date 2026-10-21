import { describe, expect, it } from 'vitest';
import { issue } from './fixtures.js';
import { activeFilterCount, applyFilters, parseFilters, serializeFilters } from './filters.js';

describe('issue filters', () => {
  it('round-trips through the URL and ignores unknown values', () => {
    const filters = parseFilters('?status=s-todo&priority=high&label=l-bug&assignee=none&x=1');
    expect(filters).toEqual({
      status: 's-todo',
      priority: 'high',
      label: 'l-bug',
      assignee: 'none',
    });
    expect(serializeFilters(filters)).toBe(
      '?status=s-todo&assignee=none&priority=high&label=l-bug',
    );
    expect(parseFilters('?priority=critical')).toEqual({});
    expect(serializeFilters({})).toBe('');
    expect(activeFilterCount(filters)).toBe(4);
  });

  it('keeps only issues matching every filter', () => {
    const bug = { id: 'l-bug', name: 'Bug', color: '#e5484d' };
    const issues = [
      issue(1, { priority: 'high', labels: [bug] }),
      issue(2, { priority: 'high', assignee: { id: 'm-ann', name: 'Ann Lee' } }),
      issue(3, { statusId: 's-done' }),
    ];
    const ids = (filters: object) => applyFilters(issues, filters).map((i) => i.number);
    expect(ids({ priority: 'high' })).toEqual([1, 2]);
    expect(ids({ priority: 'high', label: 'l-bug' })).toEqual([1]);
    expect(ids({ assignee: 'none' })).toEqual([1, 3]);
    expect(ids({ assignee: 'm-ann' })).toEqual([2]);
    expect(ids({ status: 's-done' })).toEqual([3]);
  });
});
