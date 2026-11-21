import { DEFAULT_GITHUB_URL, type GithubAppView } from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey, isKnownErrorCode } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { formatWhen } from '../issues/Comments.js';
import { buttonClass, clearSecretField, ghostButtonClass, inputClass, Panel } from './common.js';

const labelClass = 'flex flex-col gap-1 text-xs text-ink-muted';

/** GitHub's manifest flow wants a top-level form POST; a fetch cannot follow it. */
export function postManifest(url: string, manifest: string): void {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = url;
  const field = document.createElement('input');
  field.type = 'hidden';
  field.name = 'manifest';
  field.value = manifest;
  form.append(field);
  document.body.append(form);
  form.submit();
}

/**
 * Admin → Integrations → GitHub (ADR 0019): create the GitHub App from a manifest (github.com or
 * GitHub Enterprise Server), install it on repositories, or enter its details by hand. The
 * private key and webhook secret are write-only: empty fields keep what is stored.
 */
export function GithubAppPanel({ submit = postManifest }: { submit?: typeof postManifest } = {}) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<GithubAppView>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  // The manifest callback reports back in the query string once.
  const [notice] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const failed = params.get('github_error');
    if (failed) {
      return {
        error: true,
        text: isKnownErrorCode(failed) ? `errors.${failed}` : 'errors.unknown',
      };
    }
    return params.get('github') === 'created'
      ? { error: false, text: 'admin.github.created' }
      : undefined;
  });

  const reload = useCallback(async () => {
    try {
      setView(await api.githubApp());
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(undefined);
    try {
      const organization = String(form.get('organization') ?? '').trim();
      const start = await api.githubManifest({
        githubUrl: String(form.get('githubUrl') ?? '').trim(),
        organization: organization || null,
      });
      submit(start.url, start.manifest);
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    setError(undefined);
    setSaved(false);
    try {
      setView(
        await api.updateGithubApp({
          enabled: form.get('enabled') === 'on',
          githubUrl: value('githubUrl'),
          organization: value('organization') || null,
          appId: value('appId') || null,
          ...(value('privateKey') ? { privateKey: value('privateKey') } : {}),
          ...(value('webhookSecret') ? { webhookSecret: value('webhookSecret') } : {}),
        }),
      );
      clearSecretField(element, 'privateKey');
      clearSecretField(element, 'webhookSecret');
      setSaved(true);
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  async function disconnect() {
    setError(undefined);
    try {
      setView(
        await api.updateGithubApp({
          enabled: false,
          githubUrl: view!.githubUrl,
          appId: null,
          privateKey: null,
          webhookSecret: null,
        }),
      );
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  if (!view) return error ? <FormError message={error} /> : null;
  const connected = Boolean(view.appId && view.privateKeySet && view.webhookSecretSet);

  return (
    <Panel>
      <section aria-label={t('admin.github.title')} className="flex flex-col gap-3 text-sm">
        <div>
          <h3 className="font-semibold text-ink">{t('admin.github.title')}</h3>
          <p className="text-xs text-ink-muted">{t('admin.github.subtitle')}</p>
        </div>
        {notice && (
          <p
            role={notice.error ? 'alert' : 'status'}
            className={`text-xs ${notice.error ? 'text-red-600' : 'text-ink-muted'}`}
          >
            {t(notice.text)}
          </p>
        )}

        <p role="status" className="text-xs text-ink-muted">
          {connected
            ? t(view.enabled ? 'admin.github.connected' : 'admin.github.paused', {
                app: view.appSlug ?? view.appId,
              })
            : t('admin.github.notConnected')}
          {view.lastDeliveryAt &&
            ` · ${t('admin.github.lastDelivery', {
              when: formatWhen(view.lastDeliveryAt, i18n.language),
            })}`}
        </p>
        {view.lastError && (
          <p role="alert" className="text-xs text-red-600">
            {view.lastError}
          </p>
        )}

        {view.installUrl && (
          <p className="text-xs text-ink-muted">
            {t('admin.github.installHint')}{' '}
            <a
              href={view.installUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              {t('admin.github.install')}
            </a>
          </p>
        )}

        <form
          onSubmit={(event) => void create(event)}
          aria-label={t('admin.github.create')}
          className="flex flex-col gap-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              {t('admin.github.githubUrl')}
              <input
                name="githubUrl"
                type="url"
                required
                defaultValue={view.githubUrl || DEFAULT_GITHUB_URL}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              {t('admin.github.organization')}
              <input
                name="organization"
                defaultValue={view.organization ?? ''}
                className={inputClass}
              />
            </label>
          </div>
          <p className="text-xs text-ink-faint">{t('admin.github.createHint')}</p>
          <div>
            <button type="submit" className={buttonClass}>
              {t(connected ? 'admin.github.recreate' : 'admin.github.create')}
            </button>
          </div>
        </form>

        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer">{t('admin.github.manual')}</summary>
          <form
            onSubmit={(event) => void save(event)}
            aria-label={t('admin.github.manual')}
            className="mt-3 flex flex-col gap-3"
          >
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" name="enabled" defaultChecked={view.enabled} />
              {t('admin.github.enabled')}
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                {t('admin.github.githubUrl')}
                <input
                  name="githubUrl"
                  type="url"
                  required
                  defaultValue={view.githubUrl}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {t('admin.github.organization')}
                <input
                  name="organization"
                  defaultValue={view.organization ?? ''}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {t('admin.github.appId')}
                <input name="appId" defaultValue={view.appId ?? ''} className={inputClass} />
              </label>
              <label className={labelClass}>
                {t('admin.github.webhookSecret')}
                <input
                  name="webhookSecret"
                  type="password"
                  autoComplete="off"
                  placeholder={view.webhookSecretSet ? '••••••••' : ''}
                  className={inputClass}
                />
              </label>
            </div>
            <label className={labelClass}>
              {t('admin.github.privateKey')}
              <textarea
                name="privateKey"
                rows={4}
                autoComplete="off"
                placeholder={view.privateKeySet ? '••••••••' : '-----BEGIN RSA PRIVATE KEY-----'}
                className={`${inputClass} font-mono text-xs`}
              />
            </label>
            <dl className="grid gap-1">
              <dt>{t('admin.github.webhookUrl')}</dt>
              <dd className="font-mono break-all text-ink">{view.webhookUrl}</dd>
            </dl>
            <div className="flex items-center gap-2">
              <button type="submit" className={buttonClass}>
                {t('admin.github.save')}
              </button>
              {saved && <span>{t('admin.github.saved')}</span>}
            </div>
          </form>
        </details>

        <FormError message={error} />
        {connected && (
          <div>
            <button type="button" className={ghostButtonClass} onClick={() => void disconnect()}>
              {t('admin.github.disconnect')}
            </button>
          </div>
        )}
      </section>
    </Panel>
  );
}
