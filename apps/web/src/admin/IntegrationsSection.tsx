import {
  SLACK_EVENTS,
  type AdminDepartment,
  type ChatSubscriptionView,
  type SlackEvent,
} from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import {
  buttonClass,
  clearSecretField,
  ghostButtonClass,
  inputClass,
  Panel,
  SectionHeader,
} from './common.js';

const labelClass = 'flex flex-col gap-1 text-xs text-ink-muted';
const DEFAULT_EVENTS: SlackEvent[] = ['issue_created', 'request_received', 'approval_requested'];

/**
 * Admin → Integrations (SPEC §7.1): Slack channels per team through incoming webhooks.
 * The webhook URL is write-only; only its host is shown afterwards.
 */
export function IntegrationsSection() {
  const { t } = useTranslation();
  const [subscriptions, setSubscriptions] = useState<ChatSubscriptionView[]>();
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [error, setError] = useState<string>();
  const [tested, setTested] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    try {
      const [subs, depts] = await Promise.all([api.slackSubscriptions(), api.departments()]);
      setSubscriptions(subs);
      setDepartments(depts);
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const events = SLACK_EVENTS.filter((e) => form.get(`event:${e}`) === 'on');
    setError(undefined);
    try {
      await api.createSlackSubscription({
        teamId: String(form.get('teamId') ?? ''),
        name: String(form.get('name') ?? '').trim(),
        webhookUrl: String(form.get('webhookUrl') ?? '').trim(),
        events,
      });
      clearSecretField(element, 'webhookUrl');
      await reload();
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  async function test(id: string) {
    try {
      const result = await api.testSlackSubscription(id);
      setTested((current) => ({
        ...current,
        [id]: result.sent
          ? t('admin.integrations.testSent')
          : t('admin.integrations.testFailed', { status: result.status }),
      }));
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteSlackSubscription(id);
      await reload();
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  const teams = departments
    .filter((d) => !d.archivedAt)
    .flatMap((d) =>
      d.teams.filter((team) => !team.archivedAt).map((team) => ({ ...team, department: d.name })),
    );

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t('admin.integrations.title')}
        subtitle={t('admin.integrations.subtitle')}
      />
      {error && <FormError message={error} />}
      <Panel>
        <h3 className="text-sm font-semibold text-ink">{t('admin.integrations.channels')}</h3>
        {subscriptions?.length === 0 && (
          <p className="text-sm text-ink-muted">{t('admin.integrations.empty')}</p>
        )}
        <ul className="flex flex-col divide-y divide-line">
          {subscriptions?.map((sub) => (
            <li key={sub.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="font-medium text-ink">{sub.name}</span>
              <span className="text-ink-muted">
                {sub.team.name} · {sub.host}
              </span>
              <span className="text-xs text-ink-faint">
                {sub.events.map((e) => t(`admin.integrations.events.${e}`)).join(', ')}
              </span>
              <span className="ml-auto flex items-center gap-1">
                {tested[sub.id] && (
                  <span role="status" className="text-xs text-ink-muted">
                    {tested[sub.id]}
                  </span>
                )}
                <button
                  type="button"
                  className={ghostButtonClass}
                  onClick={() => void test(sub.id)}
                >
                  {t('admin.integrations.test')}
                </button>
                <button
                  type="button"
                  className={ghostButtonClass}
                  aria-label={t('admin.integrations.remove', { name: sub.name })}
                  onClick={() => void remove(sub.id)}
                >
                  {t('admin.integrations.delete')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <form
          onSubmit={(event) => void create(event)}
          className="flex flex-col gap-3"
          aria-label={t('admin.integrations.add')}
        >
          <h3 className="text-sm font-semibold text-ink">{t('admin.integrations.add')}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className={labelClass}>
              {t('admin.integrations.team')}
              <select name="teamId" required className={inputClass}>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.department} / {team.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              {t('admin.integrations.name')}
              <input
                name="name"
                required
                maxLength={120}
                placeholder="#helpdesk"
                className={inputClass}
              />
            </label>
          </div>
          <label className={labelClass}>
            {t('admin.integrations.webhookUrl')}
            <input
              name="webhookUrl"
              type="url"
              required
              autoComplete="off"
              placeholder="https://hooks.slack.com/services/…"
              className={inputClass}
            />
            <span className="text-ink-faint">{t('admin.integrations.webhookHint')}</span>
          </label>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
            <legend className="mb-1 text-xs text-ink-muted">
              {t('admin.integrations.eventsLabel')}
            </legend>
            {SLACK_EVENTS.map((e) => (
              <label key={e} className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="checkbox"
                  name={`event:${e}`}
                  defaultChecked={DEFAULT_EVENTS.includes(e)}
                />
                {t(`admin.integrations.events.${e}`)}
              </label>
            ))}
          </fieldset>
          <div>
            <button type="submit" className={buttonClass} disabled={teams.length === 0}>
              {t('admin.integrations.add')}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
