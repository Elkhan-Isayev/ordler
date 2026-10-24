import type { CycleRef } from '@ordler/shared';
import type { TFunction } from 'i18next';

/** "Cycle 3" or its custom name. */
export function cycleName(t: TFunction, cycle: Pick<CycleRef, 'number' | 'name'>): string {
  return cycle.name || t('cycles.numbered', { number: cycle.number });
}

/** "19 Oct – 1 Nov" in the UI language. */
export function cycleDates(cycle: Pick<CycleRef, 'startsOn' | 'endsOn'>, language: string): string {
  const format = new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const day = (date: string) => format.format(new Date(`${date}T00:00:00Z`));
  return `${day(cycle.startsOn)} – ${day(cycle.endsOn)}`;
}
