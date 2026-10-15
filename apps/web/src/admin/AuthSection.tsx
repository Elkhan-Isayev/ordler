import type { AdminRole } from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type AdminStrategy } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { buttonClass, inputClass, Panel, roleLabel, SectionHeader } from './common.js';

/** Admin → Sign-in methods (SPEC §8.1), Wiki.js-style per-strategy settings. */
export function AuthSection() {
  const { t } = useTranslation();
  const [strategies, setStrategies] = useState<AdminStrategy[]>();
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      const [list, roleList] = await Promise.all([api.authStrategies(), api.roles()]);
      setStrategies(list);
      setRoles(roleList);
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title={t('admin.auth.title')} subtitle={t('admin.auth.subtitle')} />
      <FormError message={error} />
      {strategies?.map((strategy) => (
        <StrategyCard key={strategy.kind} strategy={strategy} roles={roles} onSaved={reload} />
      ))}
    </section>
  );
}

function StrategyCard({
  strategy,
  roles,
  onSaved,
}: {
  strategy: AdminStrategy;
  roles: AdminRole[];
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const title = t(`admin.auth.kind_${strategy.kind}`);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const secret = String(form.get('clientSecret') ?? '');
    setError(undefined);
    setSaved(false);
    try {
      await api.updateAuthStrategy(strategy.kind, {
        enabled: form.get('enabled') === 'on',
        allowSelfRegistration: form.get('allowSelfRegistration') === 'on',
        allowedDomains: String(form.get('allowedDomains') ?? '')
          .split(',')
          .map((domain) => domain.trim())
          .filter(Boolean),
        defaultRoleId: String(form.get('defaultRoleId') ?? '') || null,
        ...(strategy.kind === 'google'
          ? {
              config: { clientId: String(form.get('clientId') ?? '').trim() || undefined },
              // Write-only: an empty field keeps the stored secret.
              ...(secret ? { secrets: { clientSecret: secret } } : {}),
            }
          : {}),
      });
      setSaved(true);
      await onSaved();
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  // Shown whenever the strategy could not work right now, enabled or not.
  const unusableHint = strategy.usable
    ? undefined
    : strategy.kind === 'email_otp'
      ? t('admin.auth.needsMail')
      : strategy.kind === 'google'
        ? t('admin.auth.needsGoogle')
        : undefined;

  return (
    <Panel>
      <form onSubmit={save} aria-label={title} className="flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-ink">{title}</h3>
          <label className="flex items-center gap-2 text-ink-muted">
            <input type="checkbox" name="enabled" defaultChecked={strategy.enabled} />
            {t('admin.auth.enabled')}
          </label>
        </div>
        {unusableHint && <p className="text-xs text-ink-faint">{unusableHint}</p>}

        {strategy.kind === 'google' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              {t('admin.auth.clientId')}
              <input
                name="clientId"
                defaultValue={strategy.config.clientId ?? ''}
                className={inputClass}
              />
            </label>
            <div className="flex flex-col gap-1 text-xs text-ink-muted">
              <label className="flex flex-col gap-1">
                {t('admin.auth.clientSecret')}
                <input
                  name="clientSecret"
                  type="password"
                  autoComplete="off"
                  placeholder={strategy.hasClientSecret ? '••••••••' : ''}
                  aria-describedby={
                    strategy.hasClientSecret ? `${strategy.kind}-secret-hint` : undefined
                  }
                  className={inputClass}
                />
              </label>
              {strategy.hasClientSecret && (
                <span id={`${strategy.kind}-secret-hint`} className="text-ink-faint">
                  {t('admin.auth.secretSet')}
                </span>
              )}
            </div>
            {strategy.callbackUrl && (
              <label className="flex flex-col gap-1 text-xs text-ink-muted sm:col-span-2">
                {t('admin.auth.callbackUrl')}
                <input
                  readOnly
                  value={strategy.callbackUrl}
                  className={`${inputClass} font-mono text-xs`}
                />
              </label>
            )}
          </div>
        )}

        {strategy.kind !== 'local' && (
          <>
            <label className="flex items-center gap-2 text-ink-muted">
              <input
                type="checkbox"
                name="allowSelfRegistration"
                defaultChecked={strategy.allowSelfRegistration}
              />
              {t('admin.auth.selfRegistration')}
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1 text-xs text-ink-muted">
                <label className="flex flex-col gap-1">
                  {t('admin.auth.allowedDomains')}
                  <input
                    name="allowedDomains"
                    defaultValue={strategy.allowedDomains.join(', ')}
                    placeholder="company.com"
                    aria-describedby={`${strategy.kind}-domains-hint`}
                    className={inputClass}
                  />
                </label>
                <span id={`${strategy.kind}-domains-hint`} className="text-ink-faint">
                  {t('admin.auth.allowedDomainsHint')}
                </span>
              </div>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                {t('admin.auth.defaultRole')}
                <select
                  name="defaultRoleId"
                  defaultValue={strategy.defaultRoleId ?? ''}
                  className={inputClass}
                >
                  <option value="">{t('admin.members.noRole')}</option>
                  {roles
                    .filter((role) => role.key !== 'owner')
                    .map((role) => (
                      <option key={role.id} value={role.id}>
                        {roleLabel(t, role)}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </>
        )}

        <FormError message={error} />
        <div className="flex items-center gap-3">
          <button type="submit" className={buttonClass}>
            {t('admin.auth.save')}
          </button>
          {saved && <span className="text-xs text-ink-muted">{t('admin.auth.saved')}</span>}
        </div>
      </form>
    </Panel>
  );
}
