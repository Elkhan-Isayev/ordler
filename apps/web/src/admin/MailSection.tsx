import { MAIL_SECURITY_MODES, type MailSettingsView, type TestMailResult } from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { buttonClass, clearSecretField, inputClass, Panel, SectionHeader } from './common.js';

const labelClass = 'flex flex-col gap-1 text-xs text-ink-muted';

/** Admin → Mail server (SPEC §8.2): SMTP for sign-in codes, invites and notifications. */
export function MailSection({ defaultTestRecipient }: { defaultTestRecipient: string }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<MailSettingsView>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async () => {
    try {
      setSettings(await api.mailSettings());
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
    const text = (name: string) => String(form.get(name) ?? '').trim();
    const password = String(form.get('password') ?? '');
    setError(undefined);
    setSaved(false);
    try {
      setSettings(
        await api.updateMailSettings({
          host: text('host'),
          port: Number(text('port')),
          security: text('security') as MailSettingsView['security'],
          verifyTls: form.get('verifyTls') === 'on',
          username: text('username') || null,
          // Write-only: an empty field keeps the stored password.
          ...(password ? { password } : {}),
          fromName: text('fromName') || null,
          fromEmail: text('fromEmail'),
        }),
      );
      clearSecretField(element, 'password');
      setSaved(true);
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  if (!settings) {
    return (
      <section className="flex flex-col gap-4">
        <SectionHeader title={t('admin.mail.title')} subtitle={t('admin.mail.subtitle')} />
        <FormError message={error} />
      </section>
    );
  }

  const fromEnv = settings.source === 'env';
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title={t('admin.mail.title')} subtitle={t('admin.mail.subtitle')} />
      {fromEnv && <p className="text-sm text-ink-muted">{t('admin.mail.fromEnv')}</p>}
      {settings.source === 'none' && (
        <p className="text-sm text-ink-muted">{t('admin.mail.notConfigured')}</p>
      )}

      <Panel>
        <form onSubmit={save} aria-label={t('admin.mail.title')} className="flex flex-col gap-3">
          <fieldset disabled={fromEnv} className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              {t('admin.mail.host')}
              <input
                name="host"
                required
                defaultValue={settings.host ?? ''}
                placeholder="smtp.company.com"
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              {t('admin.mail.port')}
              <input
                name="port"
                type="number"
                required
                min={1}
                max={65535}
                defaultValue={settings.port}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              {t('admin.mail.security')}
              <select name="security" defaultValue={settings.security} className={inputClass}>
                {MAIL_SECURITY_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`admin.mail.security_${mode}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-muted">
              <input type="checkbox" name="verifyTls" defaultChecked={settings.verifyTls} />
              {t('admin.mail.verifyTls')}
            </label>
            <label className={labelClass}>
              {t('admin.mail.username')}
              <input
                name="username"
                autoComplete="off"
                defaultValue={settings.username ?? ''}
                className={inputClass}
              />
            </label>
            <div className={labelClass}>
              <label className="flex flex-col gap-1">
                {t('admin.mail.password')}
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder={settings.passwordSet ? '••••••••' : ''}
                  aria-describedby={settings.passwordSet ? 'mail-password-hint' : undefined}
                  className={inputClass}
                />
              </label>
              {settings.passwordSet && (
                <span id="mail-password-hint" className="text-ink-faint">
                  {t('admin.auth.secretSet')}
                </span>
              )}
            </div>
            <label className={labelClass}>
              {t('admin.mail.fromName')}
              <input
                name="fromName"
                defaultValue={settings.fromName ?? ''}
                placeholder="Ordler"
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              {t('admin.mail.fromEmail')}
              <input
                name="fromEmail"
                type={fromEnv ? 'text' : 'email'}
                required
                defaultValue={settings.fromEmail ?? ''}
                placeholder="no-reply@company.com"
                className={inputClass}
              />
            </label>
          </fieldset>
          <FormError message={error} />
          {!fromEnv && (
            <div className="flex items-center gap-3">
              <button type="submit" className={buttonClass}>
                {t('admin.auth.save')}
              </button>
              {saved && (
                <span role="status" className="text-xs text-ink-muted">
                  {t('admin.auth.saved')}
                </span>
              )}
            </div>
          )}
        </form>
      </Panel>

      {settings.source !== 'none' && <TestMail defaultRecipient={defaultTestRecipient} />}
    </section>
  );
}

function TestMail({ defaultRecipient }: { defaultRecipient: string }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<TestMailResult>();
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const to = String(new FormData(event.currentTarget).get('to') ?? '').trim();
    setError(undefined);
    setResult(undefined);
    setSending(true);
    try {
      setResult(await api.sendTestMail(to));
    } catch (failure) {
      setError(t(errorKey(failure)));
    } finally {
      setSending(false);
    }
  }

  return (
    <Panel>
      <form
        onSubmit={send}
        aria-label={t('admin.mail.test')}
        className="flex flex-col gap-3 text-sm"
      >
        <h3 className="font-semibold text-ink">{t('admin.mail.test')}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className={`${labelClass} min-w-56 flex-1`}>
            {t('admin.mail.testRecipient')}
            <input
              name="to"
              type="email"
              required
              defaultValue={defaultRecipient}
              className={inputClass}
            />
          </label>
          <button type="submit" disabled={sending} className={buttonClass}>
            {t('admin.mail.sendTest')}
          </button>
        </div>
        <FormError message={error} />
        {result?.sent && (
          <p role="status" className="text-xs text-ink-muted">
            {t('admin.mail.testSent')}
          </p>
        )}
        {result && !result.sent && (
          <div role="alert" className="flex flex-col gap-1 text-xs">
            <span className="text-red-600">{t('admin.mail.testFailed')}</span>
            <code className="rounded bg-hover p-2 font-mono text-ink">{result.error}</code>
          </div>
        )}
      </form>
    </Panel>
  );
}
