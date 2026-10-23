import { CalendarDays, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Due date as a chip: "Due date" until one is chosen, then the date and a clear button.
 * A plain date input looks filled even when empty (Safari shows today), which misled people.
 * The native input stays on top, invisible, so every browser opens its own date picker.
 */
export function DueDatePicker({
  value,
  editable = true,
  onChange,
}: {
  value: string | null;
  editable?: boolean;
  onChange: (value: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const shown = value
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
        new Date(`${value}T00:00:00`),
      )
    : t('issues.dueDatePick');
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`relative inline-flex h-8 items-center gap-1.5 rounded-lg border px-2 text-sm transition-colors ${
          value ? 'border-line text-ink' : 'border-dashed border-line text-ink-faint'
        } ${editable ? 'hover:border-ink-faint hover:text-ink' : 'opacity-60'}`}
      >
        <CalendarDays aria-hidden size={14} strokeWidth={1.75} />
        {shown}
        {editable && (
          <input
            type="date"
            value={value ?? ''}
            aria-label={t('issues.dueDate')}
            onChange={(event) => onChange(event.target.value || null)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        )}
      </span>
      {editable && value && (
        <button
          type="button"
          aria-label={t('issues.dueDateClear')}
          className="rounded p-1 text-ink-faint hover:bg-hover hover:text-ink"
          onClick={() => onChange(null)}
        >
          <X aria-hidden size={14} />
        </button>
      )}
    </span>
  );
}
