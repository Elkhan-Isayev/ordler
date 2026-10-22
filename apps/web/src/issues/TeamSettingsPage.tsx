import {
  ISSUE_STATUS_CATEGORIES,
  type IssueStatusCategory,
  type TeamView,
  type WorkflowStatus,
} from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IntegrationsSection } from '../admin/IntegrationsSection.js';
import {
  buttonClass,
  ghostButtonClass,
  inputClass,
  Panel,
  SectionHeader,
} from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { selectClass, StatusIcon, statusLabel } from './ui.js';

/** Moves one id up or down among the statuses of its category; returns the full order. */
export function moveStatus(statuses: WorkflowStatus[], id: string, delta: -1 | 1): string[] {
  const ids = statuses.map((s) => s.id);
  const status = statuses.find((s) => s.id === id)!;
  const peers = statuses.filter((s) => s.category === status.category).map((s) => s.id);
  const target = peers[peers.indexOf(id) + delta];
  if (!target) return ids;
  const a = ids.indexOf(id);
  const b = ids.indexOf(target);
  [ids[a], ids[b]] = [ids[b]!, ids[a]!];
  return ids;
}

/** Team settings (/teams/KEY/settings) for team leads: workflow, labels and Slack channels. */
export function TeamSettingsPage({ teamKey }: { teamKey: string }) {
  const { t } = useTranslation();
  const [team, setTeam] = useState<TeamView>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setTeam(await api.team(teamKey));
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }, [teamKey, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(action: () => Promise<unknown>) {
    setError(undefined);
    try {
      await action();
      await reload();
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  if (!team) {
    return <div className="p-6">{error ? <FormError message={error} /> : null}</div>;
  }

  async function addStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    await run(() =>
      api.addStatus(team!.key, {
        name: String(form.get('name') ?? '').trim(),
        category: String(form.get('category')) as IssueStatusCategory,
      }),
    );
    element.reset();
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4 p-6">
      <SectionHeader
        title={`${team.name} · ${t('teamSettings.title')}`}
        subtitle={t('teamSettings.subtitle')}
      />
      {error && <FormError message={error} />}
      <Panel>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={team.settings.multipleAssignees}
            onChange={(event) =>
              void run(() => api.updateTeam(team.id, { multipleAssignees: event.target.checked }))
            }
          />
          {t('teamSettings.multipleAssignees')}
        </label>
        <p className="text-xs text-ink-faint">{t('teamSettings.multipleAssigneesHint')}</p>
      </Panel>
      <Panel>
        <h3 className="text-sm font-semibold text-ink">{t('teamSettings.workflow')}</h3>
        {ISSUE_STATUS_CATEGORIES.map((category) => {
          const statuses = team.statuses.filter((s) => s.category === category);
          if (statuses.length === 0) return null;
          return (
            <section key={category} aria-label={t(`issues.category.${category}`)}>
              <h4 className="mb-1 text-xs text-ink-faint">{t(`issues.category.${category}`)}</h4>
              <ul className="flex flex-col gap-1">
                {statuses.map((status, index) => (
                  <li key={status.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusIcon category={status.category} />
                    <input
                      key={`${status.id}-${status.name}`}
                      defaultValue={statusLabel(t, status)}
                      aria-label={t('teamSettings.statusName', { name: statusLabel(t, status) })}
                      maxLength={60}
                      className={`${inputClass} w-48 py-1`}
                      onBlur={(event) => {
                        const name = event.currentTarget.value.trim();
                        if (name && name !== statusLabel(t, status)) {
                          void run(() => api.updateWorkflowStatus(status.id, { name }));
                        }
                      }}
                    />
                    <label className="flex items-center gap-1 text-xs text-ink-muted">
                      <input
                        type="radio"
                        name="default-status"
                        checked={status.isDefault}
                        onChange={() =>
                          void run(() => api.updateWorkflowStatus(status.id, { isDefault: true }))
                        }
                      />
                      {t('teamSettings.default')}
                    </label>
                    <span className="ml-auto flex gap-1">
                      <button
                        type="button"
                        className={ghostButtonClass}
                        disabled={index === 0}
                        aria-label={t('teamSettings.moveUp', { name: statusLabel(t, status) })}
                        onClick={() =>
                          void run(() =>
                            api.reorderStatuses(team.key, moveStatus(team.statuses, status.id, -1)),
                          )
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={ghostButtonClass}
                        disabled={index === statuses.length - 1}
                        aria-label={t('teamSettings.moveDown', { name: statusLabel(t, status) })}
                        onClick={() =>
                          void run(() =>
                            api.reorderStatuses(team.key, moveStatus(team.statuses, status.id, 1)),
                          )
                        }
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className={ghostButtonClass}
                        aria-label={t('teamSettings.archive', { name: statusLabel(t, status) })}
                        onClick={() => void run(() => api.archiveStatus(status.id))}
                      >
                        {t('teamSettings.archiveShort')}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <form
          aria-label={t('teamSettings.addStatus')}
          onSubmit={(event) => void addStatus(event)}
          className="flex flex-wrap items-end gap-2"
        >
          <input
            name="name"
            required
            maxLength={60}
            aria-label={t('teamSettings.newStatus')}
            placeholder={t('teamSettings.newStatus')}
            className={inputClass}
          />
          <select
            name="category"
            aria-label={t('teamSettings.category')}
            defaultValue="started"
            className={selectClass}
          >
            {ISSUE_STATUS_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`issues.category.${category}`)}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass}>
            {t('teamSettings.addStatus')}
          </button>
        </form>
      </Panel>
      <Panel>
        <h3 className="text-sm font-semibold text-ink">{t('issues.labels.label')}</h3>
        {team.labels.length === 0 && (
          <p className="text-sm text-ink-muted">{t('teamSettings.noLabels')}</p>
        )}
        <ul className="flex flex-col gap-1">
          {team.labels.map((label) => (
            <li key={label.id} className="flex items-center gap-2 text-sm">
              <input
                type="color"
                defaultValue={label.color}
                disabled={label.scope === 'organization'}
                aria-label={t('teamSettings.labelColor', { name: label.name })}
                onChange={(event) =>
                  void run(() =>
                    api.updateLabel(label.id, { name: label.name, color: event.target.value }),
                  )
                }
              />
              <input
                key={`${label.id}-${label.name}`}
                defaultValue={label.name}
                disabled={label.scope === 'organization'}
                aria-label={t('teamSettings.labelName', { name: label.name })}
                maxLength={60}
                className={`${inputClass} w-48 py-1`}
                onBlur={(event) => {
                  const name = event.currentTarget.value.trim();
                  if (name && name !== label.name) {
                    void run(() => api.updateLabel(label.id, { name, color: label.color }));
                  }
                }}
              />
              {label.scope === 'organization' ? (
                <span className="text-xs text-ink-faint">{t('teamSettings.orgLabel')}</span>
              ) : (
                <button
                  type="button"
                  className={ghostButtonClass}
                  aria-label={t('teamSettings.deleteLabel', { name: label.name })}
                  onClick={() => void run(() => api.deleteLabel(label.id))}
                >
                  {t('admin.customRoles.delete')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </Panel>
      <IntegrationsSection team={{ id: team.id, name: team.name }} />
    </div>
  );
}
