import type { TeamView } from '@ordler/shared';
import { useTranslation } from 'react-i18next';
import { cycleName } from './format.js';

/** Cycle of an issue: none, the current one or an upcoming one (SPEC §5.2). */
export function CyclePicker({
  team,
  value,
  editable = true,
  className,
  onChange,
}: {
  team: TeamView;
  value: string | null;
  editable?: boolean;
  className: string;
  onChange: (cycleId: string | null) => void;
}) {
  const { t } = useTranslation();
  // A finished cycle is no longer offered, but an issue may still show it.
  const known = team.cycles.some((c) => c.id === value);
  return (
    <select
      value={value ?? ''}
      disabled={!editable}
      aria-label={t('cycles.cycle')}
      className={className}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">{t('cycles.noCycle')}</option>
      {value && !known && <option value={value}>{t('cycles.finished')}</option>}
      {team.cycles.map((cycle) => (
        <option key={cycle.id} value={cycle.id}>
          {cycleName(t, cycle)}
          {cycle.state === 'current' ? ` · ${t('cycles.state.current')}` : ''}
        </option>
      ))}
    </select>
  );
}
