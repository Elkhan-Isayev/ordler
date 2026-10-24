import type { CycleSettings } from '@ordler/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, Panel } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { selectClass } from '../issues/ui.js';

const labelClass = 'flex flex-col gap-1 text-xs text-ink-muted';
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/** Team settings → Cycles (SPEC §5.2): length, start day, cooldown, how far ahead. */
export function CycleSettingsPanel({ teamKey }: { teamKey: string }) {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<CycleSettings>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .teamCycles(teamKey)
      .then((data) => setSettings(data.settings))
      .catch((failure: unknown) => setError(t(errorKey(failure))));
  }, [teamKey, t]);

  if (!settings) return null;
  // 2024-01-01 was a Monday: day names in the UI language without a calendar library.
  const weekday = (n: number) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, n)),
    );

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const num = (name: string) => Number(form.get(name));
    setError(undefined);
    setSaved(false);
    try {
      const data = await api.updateCycleSettings(teamKey, {
        enabled: form.get('enabled') === 'on',
        weeks: num('weeks'),
        startDay: num('startDay'),
        cooldownWeeks: num('cooldownWeeks'),
        upcoming: num('upcoming'),
      });
      setSettings(data.settings);
      setSaved(true);
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  const select = (name: keyof CycleSettings, values: number[], text: (n: number) => string) => (
    <select name={name} defaultValue={String(settings[name])} className={selectClass}>
      {values.map((n) => (
        <option key={n} value={n}>
          {text(n)}
        </option>
      ))}
    </select>
  );

  return (
    <Panel>
      <form
        aria-label={t('cycles.settings')}
        onSubmit={(event) => void save(event)}
        className="flex flex-col gap-3"
      >
        <h3 className="text-sm font-semibold text-ink">{t('nav.cycles')}</h3>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} />
          {t('cycles.enable')}
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            {t('cycles.length')}
            {select('weeks', [1, 2, 3, 4, 6, 8], (n) => t('cycles.weeks', { count: n }))}
          </label>
          <label className={labelClass}>
            {t('cycles.startDay')}
            {select('startDay', WEEKDAYS, weekday)}
          </label>
          <label className={labelClass}>
            {t('cycles.cooldown')}
            {select('cooldownWeeks', [0, 1, 2], (n) =>
              n === 0 ? t('cycles.noCooldown') : t('cycles.weeks', { count: n }),
            )}
          </label>
          <label className={labelClass}>
            {t('cycles.upcomingCount')}
            {select('upcoming', [1, 2, 3, 4, 6], String)}
          </label>
        </div>
        <p className="text-xs text-ink-faint">{t('cycles.rolloverHint')}</p>
        {error && <FormError message={error} />}
        <div className="flex items-center gap-3">
          <button type="submit" className={buttonClass}>
            {t('admin.tokens.save')}
          </button>
          {saved && (
            <span role="status" className="text-xs text-ink-muted">
              {t('admin.tokens.saved')}
            </span>
          )}
        </div>
      </form>
    </Panel>
  );
}
