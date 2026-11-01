import { SLACK_APP_MODES, type SlackAppMode, type SlackAppView } from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { buttonClass, clearSecretField, ghostButtonClass, inputClass, Panel } from './common.js';

const labelClass = 'flex flex-col gap-1 text-xs text-ink-muted';
const SECRETS = ['botToken', 'appToken', 'signingSecret', 'clientSecret'] as const;

/**
 * Admin → Integrations → Slack app (SPEC §7.1, level 2): the manifest to create the app with,
 * then its tokens. Tokens are write-only: empty fields keep what is stored.
 */
export function SlackAppPanel() {
  const { t } = useTranslation();
  const [view, setView] = useState<SlackAppView>();
  const [mode, setMode] = useState<SlackAppMode>('socket');
  const [manifest, setManifest] = useState<string>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async () => {
    try {
      const current = await api.slackApp();
      setView(current);
      setMode(current.mode);
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const secret = (name: string) => String(form.get(name) ?? '').trim();
    setError(undefined);
    setSaved(false);
    try {
      setView(
        await api.updateSlackApp({
          enabled: form.get('enabled') === 'on',
          mode,
          clientId: secret('clientId') || null,
          ...Object.fromEntries(
            SECRETS.filter((name) => secret(name)).map((name) => [name, secret(name)]),
          ),
        }),
      );
      for (const name of SECRETS) clearSecretField(element, name);
      setSaved(true);
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  async function showManifest() {
    try {
      setManifest(JSON.stringify(await api.slackManifest(), null, 2));
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  if (!view) return error ? <FormError message={error} /> : null;
  const setFlags: Record<(typeof SECRETS)[number], boolean> = {
    botToken: view.botTokenSet,
    appToken: view.appTokenSet,
    signingSecret: view.signingSecretSet,
    clientSecret: view.clientSecretSet,
  };

  return (
    <Panel>
      <form
        onSubmit={save}
        aria-label={t('admin.slackApp.title')}
        className="flex flex-col gap-3 text-sm"
      >
        <div>
          <h3 className="font-semibold text-ink">{t('admin.slackApp.title')}</h3>
          <p className="text-xs text-ink-muted">{t('admin.slackApp.subtitle')}</p>
        </div>
        <ol className="list-decimal pl-5 text-xs text-ink-muted">
          <li>
            {t('admin.slackApp.step1')}{' '}
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => void showManifest()}
            >
              {t('admin.slackApp.showManifest')}
            </button>
          </li>
          <li>{t('admin.slackApp.step2')}</li>
          <li>{t('admin.slackApp.step3')}</li>
        </ol>
        {manifest && (
          <textarea
            readOnly
            aria-label={t('admin.slackApp.manifest')}
            value={manifest}
            rows={10}
            className={`${inputClass} font-mono text-xs`}
          />
        )}

        <p role="status" className="text-xs text-ink-muted">
          {view.workspace
            ? t('admin.slackApp.workspace', { name: view.workspace.name })
            : t('admin.slackApp.noWorkspace')}
          {view.connection !== 'n/a' && ` · ${t(`admin.slackApp.connection_${view.connection}`)}`}
          {` · ${t('admin.slackApp.linked', { count: view.linkedMembers })}`}
        </p>
        {view.lastError && (
          <p role="alert" className="text-xs text-red-600">
            {view.lastError}
          </p>
        )}

        <label className="flex items-center gap-2 text-ink-muted">
          <input type="checkbox" name="enabled" defaultChecked={view.enabled} />
          {t('admin.slackApp.enabled')}
        </label>
        <fieldset className="flex flex-wrap gap-4 text-xs text-ink-muted">
          <legend className="mb-1">{t('admin.slackApp.mode')}</legend>
          {SLACK_APP_MODES.map((option) => (
            <label key={option} className="flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                value={option}
                checked={mode === option}
                onChange={() => setMode(option)}
              />
              {t(`admin.slackApp.mode_${option}`)}
            </label>
          ))}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          {SECRETS.filter((name) =>
            mode === 'socket' ? name !== 'signingSecret' : name !== 'appToken',
          ).map((name) => (
            <label key={name} className={labelClass}>
              {t(`admin.slackApp.${name}`)}
              <input
                name={name}
                type="password"
                autoComplete="off"
                placeholder={setFlags[name] ? '••••••••' : ''}
                className={inputClass}
              />
            </label>
          ))}
          <label className={labelClass}>
            {t('admin.slackApp.clientId')}
            <input name="clientId" defaultValue={view.clientId ?? ''} className={inputClass} />
          </label>
        </div>
        <p className="text-xs text-ink-faint">{t('admin.slackApp.clientHint')}</p>

        <dl className="grid gap-1 text-xs text-ink-muted">
          <dt>{t('admin.slackApp.redirectUrl')}</dt>
          <dd className="font-mono text-ink">{view.urls.redirect}</dd>
          {mode === 'http' && (
            <>
              <dt>{t('admin.slackApp.requestUrl')}</dt>
              <dd className="font-mono text-ink">{view.urls.events}</dd>
              <dd className="font-mono text-ink">{view.urls.interactivity}</dd>
            </>
          )}
        </dl>

        <FormError message={error} />
        <div className="flex items-center gap-2">
          <button type="submit" className={buttonClass}>
            {t('admin.slackApp.save')}
          </button>
          {view.botTokenSet && (
            <button
              type="button"
              className={ghostButtonClass}
              onClick={() =>
                void api
                  .updateSlackApp({
                    enabled: false,
                    mode,
                    botToken: null,
                    appToken: null,
                    signingSecret: null,
                    clientSecret: null,
                    clientId: null,
                  })
                  .then(setView, (failure: unknown) => setError(t(errorKey(failure))))
              }
            >
              {t('admin.slackApp.disconnect')}
            </button>
          )}
          {saved && <span className="text-xs text-ink-muted">{t('admin.slackApp.saved')}</span>}
        </div>
      </form>
    </Panel>
  );
}
