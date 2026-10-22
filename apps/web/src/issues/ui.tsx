import type { IssueStatusCategory, MemberRef, Priority, WorkflowStatus } from '@ordler/shared';
import type { TFunction } from 'i18next';

/** Default statuses are translated; custom ones keep the name the team gave them. */
export function statusLabel(t: TFunction, status: Pick<WorkflowStatus, 'key' | 'name'>): string {
  return status.key ? t(`issues.status.${status.key}`, { defaultValue: status.name }) : status.name;
}

const CATEGORY_STYLE: Record<IssueStatusCategory, string> = {
  backlog: 'border-dashed border-ink-faint',
  unstarted: 'border-ink-faint',
  started: 'border-amber-500 bg-[conic-gradient(var(--color-amber-500)_0_50%,transparent_50%)]',
  completed: 'border-accent bg-accent',
  canceled: 'border-ink-faint bg-ink-faint',
};

/** Linear-style status glyph: ring, half-filled or filled circle by category. */
export function StatusIcon({ category }: { category: IssueStatusCategory }) {
  return (
    <span
      aria-hidden
      data-category={category}
      className={`inline-block size-3.5 shrink-0 rounded-full border-[1.5px] ${CATEGORY_STYLE[category]}`}
    />
  );
}

const PRIORITY_BARS: Record<Exclude<Priority, 'none' | 'urgent'>, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** Bars for high/medium/low, an exclamation mark for urgent, a dash for none. */
export function PriorityIcon({ priority }: { priority: Priority }) {
  if (priority === 'none') {
    return (
      <span aria-hidden className="inline-flex w-3.5 justify-center text-ink-faint">
        –
      </span>
    );
  }
  if (priority === 'urgent') {
    return (
      <span
        aria-hidden
        className="inline-flex size-3.5 items-center justify-center rounded-sm bg-orange-500 text-[10px] font-bold text-white"
      >
        !
      </span>
    );
  }
  const filled = PRIORITY_BARS[priority];
  return (
    <span aria-hidden className="inline-flex h-3.5 w-3.5 items-end gap-px">
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          className={`w-1 rounded-[1px] ${bar <= filled ? 'bg-ink-muted' : 'bg-line'}`}
          style={{ height: `${bar * 33}%` }}
        />
      ))}
    </span>
  );
}

export function Avatar({ member }: { member: MemberRef | null }) {
  if (!member) {
    return (
      <span
        aria-hidden
        className="inline-block size-5 rounded-full border border-dashed border-ink-faint"
      />
    );
  }
  // Letters only, so "Aliya (CS)" gives "AC" rather than "A(".
  const initials = member.name
    .split(/\s+/)
    .map((part) => part.match(/\p{L}/u)?.[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      title={member.name}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[10px] font-semibold text-ink"
    >
      {initials || '?'}
    </span>
  );
}

export const selectClass =
  'rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent disabled:opacity-60';

/** A label as a small pill with its color dot. */
export function LabelChip({ label }: { label: { name: string; color: string } }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-0.5 text-[11px] text-ink-muted">
      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: label.color }} />
      {label.name}
    </span>
  );
}

/** Up to three overlapping avatars and a count for the rest. */
export function AvatarStack({ members }: { members: MemberRef[] }) {
  if (members.length === 0) return <Avatar member={null} />;
  const shown = members.slice(0, 3);
  return (
    <span className="flex items-center -space-x-1.5" title={members.map((m) => m.name).join(', ')}>
      {shown.map((member) => (
        <span key={member.id} className="rounded-full ring-2 ring-surface">
          <Avatar member={member} />
        </span>
      ))}
      {members.length > shown.length && (
        <span className="pl-2 text-[10px] text-ink-faint">+{members.length - shown.length}</span>
      )}
    </span>
  );
}
