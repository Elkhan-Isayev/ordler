import type { IssueSummary } from '@ordler/shared';
import { useTranslation } from 'react-i18next';
import { Timeline, type TimelineItem } from '../components/Timeline.js';
import { Link } from '../router.js';
import { StatusIcon } from './ui.js';

/**
 * Issues with a due date as bars from creation to the due date (SPEC §5.4); issues without one
 * are listed underneath so a filter never silently hides them.
 */
export function IssueTimeline({ issues, today }: { issues: IssueSummary[]; today?: string }) {
  const { t, i18n } = useTranslation();
  const format = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
  const date = (iso: string) => format.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
  const dated = issues
    .filter((issue): issue is IssueSummary & { dueDate: string } => issue.dueDate !== null)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number - b.number);
  const undated = issues.filter((issue) => issue.dueDate === null);

  const items: TimelineItem[] = dated.map((issue) => {
    const created = issue.createdAt.slice(0, 10);
    const start = created < issue.dueDate ? created : issue.dueDate;
    return {
      id: issue.id,
      href: `/issue/${issue.identifier}`,
      label: issue.title,
      prefix: (
        <>
          <span className="w-16 shrink-0 text-xs text-ink-faint">{issue.identifier}</span>
          <StatusIcon category={issue.status.category} />
        </>
      ),
      start,
      end: issue.dueDate,
      done: issue.status.category === 'completed' || issue.status.category === 'canceled',
      title: t('timeline.issueDates', { start: date(start), end: date(issue.dueDate) }),
    };
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Timeline items={items} label={t('issues.timeline')} {...(today ? { today } : {})} />
      {undated.length > 0 && (
        <section aria-label={t('timeline.noDueDate')} className="border-t border-line">
          <h2 className="bg-sidebar px-4 py-2 text-sm font-medium text-ink">
            {t('timeline.noDueDate')}{' '}
            <span className="font-normal text-ink-faint">{undated.length}</span>
          </h2>
          <ul className="max-h-60 overflow-y-auto">
            {undated.map((issue) => (
              <li key={issue.id} className="border-b border-line">
                <Link
                  href={`/issue/${issue.identifier}`}
                  className="flex items-center gap-3 px-4 py-1.5 text-sm hover:bg-hover"
                >
                  <span className="w-16 shrink-0 text-xs text-ink-faint">{issue.identifier}</span>
                  <StatusIcon category={issue.status.category} />
                  <span className="truncate text-ink">{issue.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
