import {
  PRIORITIES,
  type AdminDepartment,
  type CalendarInput,
  type CalendarView,
  type Priority,
  type SlaPolicyInput,
  type SlaPolicyView,
} from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { selectClass } from '../issues/ui.js';
import { buttonClass, ghostButtonClass, inputClass, Panel, SectionHeader } from './common.js';

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Minutes to an hours field ("1.5"); empty when there is no target. */
const toHours = (minutes: number | null) => (minutes === null ? '' : String(minutes / 60));
const toMinutes = (hours: string) => {
  const value = Number(hours.replace(',', '.'));
  return hours.trim() === '' || !Number.isFinite(value) || value <= 0
    ? null
    : Math.round(value * 60);
};

function weekdayName(language: string, day: number): string {
  // 2024-01-01 was a Monday.
  return new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, day)),
  );
}

/** Admin → SLA (SPEC §6.5): business calendars and SLA policies of a department. */
export function SlaSection() {
  const { t } = useTranslation();
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [calendars, setCalendars] = useState<CalendarView[]>([]);
  const [policies, setPolicies] = useState<SlaPolicyView[]>([]);
  const [editCalendar, setEditCalendar] = useState<CalendarView | 'new'>();
  const [editPolicy, setEditPolicy] = useState<SlaPolicyView | 'new'>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void api
      .departments()
      .then((list) => {
        const active = list.filter((d) => !d.archivedAt);
        setDepartments(active);
        setDepartmentId(active[0]?.id ?? '');
      })
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, []);

  const reload = useCallback(async () => {
    if (!departmentId) return;
    try {
      const [cals, pols] = await Promise.all([
        api.calendars(departmentId),
        api.slaPolicies(departmentId),
      ]);
      setCalendars(cals);
      setPolicies(pols);
      setError(undefined);
    } catch (failure) {
      setError(errorKey(failure));
    }
  }, [departmentId]);
  useEffect(() => {
    setEditCalendar(undefined);
    setEditPolicy(undefined);
    void reload();
  }, [reload]);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await reload();
      return true;
    } catch (failure) {
      setError(errorKey(failure));
      return false;
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title={t('admin.nav.sla')} subtitle={t('sla.subtitle')} />
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        {t('sla.department')}
        <select
          value={departmentId}
          className={`${selectClass} w-64`}
          onChange={(e) => setDepartmentId(e.target.value)}
        >
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {error && <FormError message={t(error)} />}

      <Panel>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">{t('sla.calendars')}</h3>
          <button
            type="button"
            className={`${ghostButtonClass} ml-auto`}
            onClick={() => setEditCalendar('new')}
          >
            {t('sla.newCalendar')}
          </button>
        </div>
        {calendars.length === 0 && <p className="text-sm text-ink-muted">{t('sla.noCalendars')}</p>}
        <ul className="flex flex-col divide-y divide-line">
          {calendars.map((calendar) => (
            <li key={calendar.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="font-medium text-ink">{calendar.name}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
                <CalendarSummary calendar={calendar} />
              </span>
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => setEditCalendar(calendar)}
              >
                {t('comments.edit')}
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => void run(() => api.archiveCalendar(calendar.id))}
              >
                {t('sla.archive')}
              </button>
            </li>
          ))}
        </ul>
        {editCalendar && (
          <CalendarForm
            key={editCalendar === 'new' ? 'new' : editCalendar.id}
            calendar={editCalendar === 'new' ? undefined : editCalendar}
            onCancel={() => setEditCalendar(undefined)}
            onSave={async (input) => {
              const ok = await run(() =>
                editCalendar === 'new'
                  ? api.createCalendar(departmentId, input)
                  : api.updateCalendar(editCalendar.id, input),
              );
              if (ok) setEditCalendar(undefined);
            }}
          />
        )}
      </Panel>

      <Panel>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">{t('sla.policies')}</h3>
          <button
            type="button"
            className={`${ghostButtonClass} ml-auto`}
            onClick={() => setEditPolicy('new')}
          >
            {t('sla.newPolicy')}
          </button>
        </div>
        {policies.length === 0 && <p className="text-sm text-ink-muted">{t('sla.noPolicies')}</p>}
        <ul className="flex flex-col divide-y divide-line">
          {policies.map((policy) => (
            <li key={policy.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="font-medium text-ink">{policy.name}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
                {policy.calendar?.name ?? t('sla.allDay')}
              </span>
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => setEditPolicy(policy)}
              >
                {t('comments.edit')}
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => {
                  if (window.confirm(t('sla.confirmArchivePolicy', { name: policy.name }))) {
                    void run(() => api.archiveSlaPolicy(policy.id));
                  }
                }}
              >
                {t('sla.archive')}
              </button>
            </li>
          ))}
        </ul>
        {editPolicy && (
          <PolicyForm
            key={editPolicy === 'new' ? 'new' : editPolicy.id}
            policy={editPolicy === 'new' ? undefined : editPolicy}
            calendars={calendars}
            onCancel={() => setEditPolicy(undefined)}
            onSave={async (input) => {
              const ok = await run(() =>
                editPolicy === 'new'
                  ? api.createSlaPolicy(departmentId, input)
                  : api.updateSlaPolicy(editPolicy.id, input),
              );
              if (ok) setEditPolicy(undefined);
            }}
          />
        )}
      </Panel>
    </section>
  );
}

function CalendarSummary({ calendar }: { calendar: CalendarView }) {
  const { i18n } = useTranslation();
  const days = [...new Set(calendar.hours.map((h) => h.day))].sort();
  const first = calendar.hours[0];
  return (
    <>
      {calendar.timezone} · {days.map((d) => weekdayName(i18n.language, d)).join(', ')}
      {first && ` · ${first.start}–${first.end}`}
    </>
  );
}

function CalendarForm({
  calendar,
  onSave,
  onCancel,
}: {
  calendar: CalendarView | undefined;
  onSave: (input: CalendarInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState<number[]>(
    calendar ? [...new Set(calendar.hours.map((h) => h.day))] : [1, 2, 3, 4, 5],
  );
  const zones =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const start = String(form.get('start'));
    const end = String(form.get('end'));
    await onSave({
      name: String(form.get('name') ?? '').trim(),
      timezone: String(form.get('timezone') ?? '').trim(),
      // One interval per working day; split shifts can still come through the API.
      hours: days.sort().map((day) => ({ day, start, end })),
      holidays: String(form.get('holidays') ?? '')
        .split(/[\s,]+/)
        .filter(Boolean),
    });
  }

  return (
    <form
      aria-label={calendar ? t('sla.editCalendar') : t('sla.newCalendar')}
      className="flex flex-col gap-3 border-t border-line pt-3"
      onSubmit={(e) => void submit(e)}
    >
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t('sla.name')}
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={calendar?.name ?? ''}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t('sla.timezone')}
          <input
            name="timezone"
            required
            list="sla-timezones"
            defaultValue={calendar?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}
            className={inputClass}
          />
          <datalist id="sla-timezones">
            {zones.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t('sla.from')}
          <input
            name="start"
            type="time"
            required
            defaultValue={calendar?.hours[0]?.start ?? '09:00'}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t('sla.to')}
          <input
            name="end"
            type="time"
            required
            defaultValue={calendar?.hours[0]?.end ?? '18:00'}
            className={inputClass}
          />
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-xs text-ink-muted">{t('sla.workingDays')}</legend>
        {DAYS.map((day) => (
          <label key={day} className="flex items-center gap-1 text-sm text-ink">
            <input
              type="checkbox"
              checked={days.includes(day)}
              onChange={() =>
                setDays((list) =>
                  list.includes(day) ? list.filter((d) => d !== day) : [...list, day],
                )
              }
            />
            {weekdayName(i18n.language, day)}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        {t('sla.holidays')}
        <textarea
          name="holidays"
          rows={2}
          defaultValue={calendar?.holidays.join('\n') ?? ''}
          placeholder="2026-12-31"
          className={inputClass}
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" className={buttonClass} disabled={days.length === 0}>
          {t('sla.save')}
        </button>
        <button type="button" className={ghostButtonClass} onClick={onCancel}>
          {t('issues.cancel')}
        </button>
      </div>
    </form>
  );
}

function PolicyForm({
  policy,
  calendars,
  onSave,
  onCancel,
}: {
  policy: SlaPolicyView | undefined;
  calendars: CalendarView[];
  onSave: (input: SlaPolicyInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const targets = Object.fromEntries(
      PRIORITIES.map((p) => [
        p,
        {
          firstResponseMinutes: toMinutes(String(form.get(`${p}.first`) ?? '')),
          resolutionMinutes: toMinutes(String(form.get(`${p}.resolution`) ?? '')),
        },
      ]),
    ) as Record<
      Priority,
      { firstResponseMinutes: number | null; resolutionMinutes: number | null }
    >;
    await onSave({
      name: String(form.get('name') ?? '').trim(),
      calendarId: String(form.get('calendarId') ?? '') || null,
      pauseDuringApproval: form.get('pause') === 'on',
      targets,
    });
  }

  return (
    <form
      aria-label={policy ? t('sla.editPolicy') : t('sla.newPolicy')}
      className="flex flex-col gap-3 border-t border-line pt-3"
      onSubmit={(e) => void submit(e)}
    >
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t('sla.name')}
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={policy?.name ?? ''}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t('sla.calendar')}
          <select
            name="calendarId"
            defaultValue={policy?.calendar?.id ?? ''}
            className={selectClass}
          >
            <option value="">{t('sla.allDay')}</option>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="pause" defaultChecked={policy?.pauseDuringApproval ?? true} />
        {t('sla.pauseDuringApproval')}
      </label>
      <table className="text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-muted">
            <th className="py-1 font-normal">{t('issues.priority.label')}</th>
            <th className="py-1 font-normal">{t('sla.firstResponseHours')}</th>
            <th className="py-1 font-normal">{t('sla.resolutionHours')}</th>
          </tr>
        </thead>
        <tbody>
          {PRIORITIES.map((p) => (
            <tr key={p}>
              <td className="py-1 pr-3 text-ink">{t(`issues.priority.${p}`)}</td>
              <td className="py-1 pr-3">
                <input
                  name={`${p}.first`}
                  inputMode="decimal"
                  aria-label={t('sla.firstResponseFor', { priority: t(`issues.priority.${p}`) })}
                  defaultValue={toHours(policy?.targets[p]?.firstResponseMinutes ?? null)}
                  className={`${inputClass} w-24`}
                />
              </td>
              <td className="py-1">
                <input
                  name={`${p}.resolution`}
                  inputMode="decimal"
                  aria-label={t('sla.resolutionFor', { priority: t(`issues.priority.${p}`) })}
                  defaultValue={toHours(policy?.targets[p]?.resolutionMinutes ?? null)}
                  className={`${inputClass} w-24`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-ink-faint">{t('sla.targetsHint')}</p>
      <div className="flex gap-2">
        <button type="submit" className={buttonClass}>
          {t('sla.save')}
        </button>
        <button type="button" className={ghostButtonClass} onClick={onCancel}>
          {t('issues.cancel')}
        </button>
      </div>
    </form>
  );
}
