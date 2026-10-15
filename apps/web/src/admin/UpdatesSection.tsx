import type { UpdateStatusResponse } from '@ordler/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { buttonClass, Panel, SectionHeader } from './common.js';

export function UpdatesSection() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<UpdateStatusResponse>();
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api
      .updateStatus()
      .then(setStatus)
      .catch((failure: unknown) => setError(t(errorKey(failure))));
  }, [t]);

  async function checkNow() {
    setChecking(true);
    setError(undefined);
    try {
      setStatus(await api.checkForUpdates());
    } catch (failure) {
      setError(t(errorKey(failure)));
    } finally {
      setChecking(false);
    }
  }

  const format = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(iso),
        )
      : t('admin.updates.never');

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title={t('admin.updates.title')} />
      <FormError message={error} />
      {status && (
        <Panel>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-ink-muted">{t('admin.updates.current')}</dt>
            <dd className="text-ink">{status.currentVersion ?? t('admin.updates.development')}</dd>
            <dt className="text-ink-muted">{t('admin.updates.latest')}</dt>
            <dd className="text-ink">{status.latestVersion ?? t('admin.updates.unknown')}</dd>
            <dt className="text-ink-muted">{t('admin.updates.checkedAt')}</dt>
            <dd className="text-ink">{format(status.checkedAt)}</dd>
          </dl>
          {!status.enabled && (
            <p className="text-sm text-ink-muted">{t('admin.updates.disabled')}</p>
          )}
          {status.enabled && status.updateAvailable && status.latestVersion && (
            <p className="text-sm text-ink">
              {t('admin.updates.available', { latest: status.latestVersion })}
            </p>
          )}
          {status.enabled &&
            !status.updateAvailable &&
            status.currentVersion &&
            status.latestVersion && (
              <p className="text-sm text-ink-muted">{t('admin.updates.upToDate')}</p>
            )}
          {status.lastError && (
            <p className="text-sm text-amber-600">
              {t('admin.updates.lastError', { error: status.lastError })}
            </p>
          )}
          <div className="flex items-center gap-3">
            {status.enabled && (
              <button type="button" onClick={checkNow} disabled={checking} className={buttonClass}>
                {t('admin.updates.checkNow')}
              </button>
            )}
            {status.release && (
              <a
                href={status.release.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent hover:underline"
              >
                {t('admin.updates.releaseNotes')}
              </a>
            )}
          </div>
        </Panel>
      )}
    </section>
  );
}
