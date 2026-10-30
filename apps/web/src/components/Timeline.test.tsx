import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '../test/render.js';
import { barGeometry, Timeline, timelineRange, type TimelineItem } from './Timeline.js';

const DAY = 86_400_000;
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const item = (id: string, start: string | null, end: string): TimelineItem => ({
  id,
  href: `/x/${id}`,
  label: `Item ${id}`,
  start,
  end,
  title: `${start ?? ''} – ${end}`,
});

describe('timelineRange', () => {
  it('starts on the Monday before the earliest date and spans at least eight weeks', () => {
    // 2026-10-30 is a Friday; the Monday before is 2026-10-26.
    const range = timelineRange([item('a', '2026-11-04', '2026-11-06')], '2026-10-30');
    expect(range.start).toBe(day('2026-10-26'));
    expect(range.weeks).toBe(8);
  });

  it('grows to cover long plans and dates in the past', () => {
    const range = timelineRange([item('a', '2026-09-01', '2027-03-01')], '2026-10-30');
    expect(range.start).toBe(day('2026-08-31'));
    expect(range.start + range.weeks * 7).toBeGreaterThan(day('2027-03-01'));
  });
});

describe('barGeometry', () => {
  it('places a bar by its dates and a marker at its end date', () => {
    const range = { start: day('2026-10-26'), weeks: 2 };
    expect(barGeometry(item('a', '2026-10-26', '2026-11-01'), range)).toEqual({
      left: 0,
      width: 0.5,
    });
    expect(barGeometry(item('b', null, '2026-11-02'), range)).toEqual({
      left: 0.5,
      width: 1 / 14,
    });
  });
});

describe('Timeline', () => {
  it('labels rows and bars with links and readable dates', async () => {
    await renderWithI18n(
      <Timeline
        label="Timeline"
        today="2026-10-30"
        items={[item('a', '2026-11-02', '2026-11-06')]}
      />,
    );
    expect(screen.getByRole('region', { name: 'Timeline' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Item a: 2026-11-02 – 2026-11-06' })).toHaveAttribute(
      'href',
      '/x/a',
    );
  });

  it('says so when nothing has dates', async () => {
    await renderWithI18n(<Timeline label="Timeline" today="2026-10-30" items={[]} />);
    expect(screen.getByText('Nothing with dates to show.')).toBeInTheDocument();
  });
});
