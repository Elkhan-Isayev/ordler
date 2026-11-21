import type { TeamGithubSettings, TeamView } from '@ordler/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { selectClass, statusLabel } from './ui.js';

const FIELDS = ['openedStatusId', 'mergedStatusId'] as const;

/** Team settings → GitHub (ADR 0019): statuses set when a linked pull request opens or merges. */
export function TeamGithubPanel({ team }: { team: Pick<TeamView, 'key' | 'statuses'> }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<TeamGithubSettings>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.teamGithub(team.key).then(setSettings, (failure: unknown) => setError(errorKey(failure)));
  }, [team.key]);

  async function change(field: (typeof FIELDS)[number], value: string) {
    if (!settings) return;
    setError(undefined);
    try {
      setSettings(await api.updateTeamGithub(team.key, { ...settings, [field]: value || null }));
    } catch (failure) {
      setError(errorKey(failure));
    }
  }

  return (
    <Panel>
      <section aria-label={t('teamSettings.github.title')} className="flex flex-col gap-3 text-sm">
        <div>
          <h3 className="font-semibold text-ink">{t('teamSettings.github.title')}</h3>
          <p className="text-xs text-ink-muted">{t('teamSettings.github.subtitle')}</p>
        </div>
        {settings &&
          FIELDS.map((field) => (
            <label key={field} className="flex flex-wrap items-center gap-2 text-ink-muted">
              <span className="w-56">{t(`teamSettings.github.${field}`)}</span>
              <select
                value={settings[field] ?? ''}
                aria-label={t(`teamSettings.github.${field}`)}
                className={selectClass}
                onChange={(event) => void change(field, event.target.value)}
              >
                <option value="">{t('teamSettings.github.off')}</option>
                {team.statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {statusLabel(t, status)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        <FormError message={error ? t(error) : undefined} />
      </section>
    </Panel>
  );
}
