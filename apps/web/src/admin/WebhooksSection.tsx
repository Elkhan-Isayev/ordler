import {
  WEBHOOK_EVENTS,
  type AdminDepartment,
  type WebhookDeliveryView,
  type WebhookView,
} from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { formatWhen } from '../issues/Comments.js';
import { selectClass } from '../issues/ui.js';
import {
  buttonClass,
  ghostButtonClass,
  inputClass,
  Panel,
  scopeLabel,
  scopeOptions,
  SectionHeader,
} from './common.js';

type EventName = (typeof WEBHOOK_EVENTS)[number];

/** Admin → Webhooks (SPEC §10): endpoints, their secret (shown once) and the delivery log. */
export function WebhooksSection() {
  const { t } = useTranslation();
  const [hooks, setHooks] = useState<WebhookView[]>();
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [secret, setSecret] = useState<{ name: string; value: string }>();
  const [error, setError] = useState<string>();

  const reload = useCallback(() => {
    void api
      .webhooks()
      .then(setHooks)
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, []);
  useEffect(() => {
    reload();
    void api
      .departments()
      .then(setDepartments)
      .catch(() => undefined);
  }, [reload]);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setError(undefined);
      reload();
    } catch (failure) {
      setError(errorKey(failure));
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title={t('admin.nav.webhooks')} subtitle={t('webhooks.subtitle')} />
      {error && <FormError message={t(error)} />}
      {secret && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-accent p-4">
          <p className="text-sm text-ink">{t('webhooks.secretOnce', { name: secret.name })}</p>
          <code className="rounded-md bg-hover px-2 py-1 text-sm break-all text-ink">
            {secret.value}
          </code>
          <p className="text-xs text-ink-muted">{t('webhooks.verifyHint')}</p>
          <div>
            <button type="button" className={ghostButtonClass} onClick={() => setSecret(undefined)}>
              {t('webhooks.done')}
            </button>
          </div>
        </div>
      )}
      <CreateForm
        departments={departments}
        onCreated={(name, value) => {
          setSecret({ name, value });
          reload();
        }}
      />
      {hooks?.length === 0 && <p className="text-sm text-ink-muted">{t('webhooks.empty')}</p>}
      {hooks?.map((hook) => (
        <Endpoint
          key={hook.id}
          hook={hook}
          departments={departments}
          onAction={run}
          onSecret={(value) => setSecret({ name: hook.name, value })}
        />
      ))}
    </section>
  );
}

function EventChecklist({
  value,
  onChange,
}: {
  value: EventName[];
  onChange: (events: EventName[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-xs text-ink-muted">{t('webhooks.events')}</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {WEBHOOK_EVENTS.map((event) => (
          <label key={event} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={value.includes(event)}
              onChange={() =>
                onChange(
                  value.includes(event) ? value.filter((e) => e !== event) : [...value, event],
                )
              }
            />
            {t(`webhooks.event.${event.replace('.', '_')}`)}
            <code className="text-xs text-ink-faint">{event}</code>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CreateForm({
  departments,
  onCreated,
}: {
  departments: AdminDepartment[];
  onCreated: (name: string, secret: string) => void;
}) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<EventName[]>(['issue.created', 'issue.updated']);
  const [scope, setScope] = useState('organization');
  const [error, setError] = useState<string>();
  const scopes = scopeOptions(t, departments);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const created = await api.createWebhook({
        name: String(data.get('name') ?? '').trim(),
        url: String(data.get('url') ?? '').trim(),
        events,
        scope: scopes.find((s) => s.value === scope)!.scope,
      });
      form.reset();
      setError(undefined);
      onCreated(created.webhook.name, created.secret);
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  return (
    <Panel>
      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <h3 className="text-sm font-semibold text-ink">{t('webhooks.add')}</h3>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            {t('webhooks.name')}
            <input name="name" required maxLength={120} className={inputClass} />
          </label>
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-ink-muted">
            {t('webhooks.url')}
            <input
              name="url"
              type="url"
              required
              placeholder="https://ci.example.com/hooks/ordler"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            {t('webhooks.scope')}
            <select
              value={scope}
              className={selectClass}
              onChange={(e) => setScope(e.target.value)}
            >
              {scopes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <EventChecklist value={events} onChange={setEvents} />
        {error && <FormError message={error} />}
        <div>
          <button type="submit" className={buttonClass} disabled={events.length === 0}>
            {t('webhooks.create')}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function Endpoint({
  hook,
  departments,
  onAction,
  onSecret,
}: {
  hook: WebhookView;
  departments: AdminDepartment[];
  onAction: (action: () => Promise<unknown>) => Promise<void>;
  onSecret: (secret: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [log, setLog] = useState<WebhookDeliveryView[]>();
  const [editing, setEditing] = useState(false);
  const [events, setEvents] = useState<EventName[]>(hook.events);

  const loadLog = useCallback(() => {
    void api
      .webhookDeliveries(hook.id)
      .then(setLog)
      .catch(() => undefined);
  }, [hook.id]);

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{hook.name}</h3>
        <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{hook.url}</span>
        <span className="rounded-full bg-hover px-2 py-0.5 text-xs text-ink-muted">
          {hook.enabled ? t('webhooks.enabled') : t('webhooks.disabled')}
        </span>
      </div>
      <p className="text-xs text-ink-muted">
        {scopeLabel(t, hook.scope, departments)} · {hook.events.join(', ')}
      </p>
      <p className="text-xs text-ink-muted">
        {hook.lastDeliveryAt
          ? t('webhooks.lastDelivery', { when: formatWhen(hook.lastDeliveryAt, i18n.language) })
          : t('webhooks.noDeliveries')}
        {hook.recentFailures > 0 && ` · ${t('webhooks.failures', { count: hook.recentFailures })}`}
      </p>
      {editing && (
        <div className="flex flex-col gap-2">
          <EventChecklist value={events} onChange={setEvents} />
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={events.length === 0}
              onClick={() =>
                void onAction(() => api.updateWebhook(hook.id, { events })).then(() =>
                  setEditing(false),
                )
              }
            >
              {t('webhooks.save')}
            </button>
            <button type="button" className={ghostButtonClass} onClick={() => setEditing(false)}>
              {t('issues.cancel')}
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={ghostButtonClass} onClick={() => setEditing(true)}>
          {t('webhooks.editEvents')}
        </button>
        <button
          type="button"
          className={ghostButtonClass}
          onClick={() => void onAction(() => api.testWebhook(hook.id)).then(loadLog)}
        >
          {t('webhooks.test')}
        </button>
        <button
          type="button"
          className={ghostButtonClass}
          onClick={() =>
            void onAction(() => api.updateWebhook(hook.id, { enabled: !hook.enabled }))
          }
        >
          {hook.enabled ? t('webhooks.disable') : t('webhooks.enable')}
        </button>
        <button
          type="button"
          className={ghostButtonClass}
          onClick={() => {
            if (window.confirm(t('webhooks.confirmRotate'))) {
              void onAction(async () => onSecret((await api.rotateWebhookSecret(hook.id)).secret));
            }
          }}
        >
          {t('webhooks.rotate')}
        </button>
        <button
          type="button"
          className={ghostButtonClass}
          onClick={() => (log ? setLog(undefined) : loadLog())}
        >
          {log ? t('webhooks.hideLog') : t('webhooks.showLog')}
        </button>
        <button
          type="button"
          className={`${ghostButtonClass} ml-auto text-red-600 dark:text-red-400`}
          onClick={() => {
            if (window.confirm(t('webhooks.confirmDelete', { name: hook.name }))) {
              void onAction(() => api.deleteWebhook(hook.id));
            }
          }}
        >
          {t('webhooks.delete')}
        </button>
      </div>
      {log && (
        <ul aria-label={t('webhooks.log')} className="flex flex-col text-xs">
          {log.length === 0 && <li className="text-ink-muted">{t('webhooks.noDeliveries')}</li>}
          {log.map((delivery) => (
            <li key={delivery.id} className="flex items-center gap-3 border-t border-line py-1.5">
              <span className="w-36 shrink-0 text-ink-muted">
                {formatWhen(delivery.createdAt, i18n.language)}
              </span>
              <code className="w-40 shrink-0 text-ink">{delivery.event}</code>
              <span className="text-ink">{t(`webhooks.status.${delivery.status}`)}</span>
              <span className="min-w-0 flex-1 truncate text-ink-muted">
                {delivery.error ??
                  (delivery.responseStatus ? `HTTP ${delivery.responseStatus}` : '')}
                {delivery.attempts > 1 &&
                  ` · ${t('webhooks.attempts', { count: delivery.attempts })}`}
              </span>
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => void onAction(() => api.redeliverWebhook(delivery.id)).then(loadLog)}
              >
                {t('webhooks.redeliver')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
