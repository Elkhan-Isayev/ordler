import type { DatabaseSettingsView, DatabaseUpdateResult } from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { DatabaseFields, ProbeOutcome, readDatabaseForm } from '../database/DatabaseFields.js';
import { buttonClass, clearSecretField, Panel, SectionHeader } from './common.js';

/**
 * Admin → Database (SPEC §16.3): the connection Ordler stores its data in. Admins see it;
 * Owners can change installer-saved settings, which apply after a restart.
 */
export function DatabaseSection({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<DatabaseSettingsView>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<DatabaseUpdateResult>();
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      setSettings(await api.databaseSettings());
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError(undefined);
    setResult(undefined);
    setSaving(true);
    try {
      const outcome = await api.updateDatabaseSettings(readDatabaseForm(new FormData(form)));
      if (outcome.saved) clearSecretField(form, 'password');
      setResult(outcome);
    } catch (failure) {
      setError(t(errorKey(failure)));
    } finally {
      setSaving(false);
    }
  }

  const rows: Array<[string, string]> = settings
    ? [
        [t('database.host'), settings.host ?? '—'],
        [t('database.port'), settings.port ? String(settings.port) : '—'],
        [t('database.name'), settings.database ?? '—'],
        [t('database.user'), settings.user ?? '—'],
        [t('database.schema'), settings.schema],
        [t('database.ssl'), t(`database.ssl_${settings.ssl.replace('-', '_')}`)],
        [t('database.serverVersion'), settings.serverVersion ?? '—'],
      ]
    : [];

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title={t('admin.database.title')} subtitle={t('admin.database.subtitle')} />
      <FormError message={error} />
      {settings && (
        <>
          <Panel>
            <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="font-mono text-ink break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-ink-faint">
              {settings.source === 'env'
                ? t('admin.database.fromEnv')
                : t('admin.database.fromInstaller')}
            </p>
          </Panel>

          {settings.source === 'file' && canEdit && (
            <Panel>
              <form
                onSubmit={save}
                aria-label={t('admin.database.change')}
                className="flex flex-col gap-3"
              >
                <h3 className="text-sm font-semibold text-ink">{t('admin.database.change')}</h3>
                <p className="text-xs text-ink-muted">{t('admin.database.changeWarning')}</p>
                <DatabaseFields defaults={settings} passwordSet={settings.passwordSet} />
                {result?.saved ? (
                  <p role="status" className="text-xs text-ink-muted">
                    {t('admin.database.restartRequired')}
                  </p>
                ) : (
                  result && (
                    <ProbeOutcome
                      result={{
                        ok: false,
                        error: result.error,
                        ...(result.detail ? { detail: result.detail } : {}),
                      }}
                    />
                  )
                )}
                <div>
                  <button type="submit" disabled={saving} className={buttonClass}>
                    {t('admin.auth.save')}
                  </button>
                </div>
              </form>
            </Panel>
          )}
        </>
      )}
    </section>
  );
}
