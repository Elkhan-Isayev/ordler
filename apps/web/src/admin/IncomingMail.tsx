import {
  MAIL_SECURITY_MODES,
  type InboundEmailView,
  type InboxPollResult,
  type InboxSettingsView,
} from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey, isKnownErrorCode } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { buttonClass, clearSecretField, ghostButtonClass, inputClass, Panel } from './common.js';

const labelClass = 'flex flex-col gap-1 text-xs text-ink-muted';

/**
 * Admin → Mail → Incoming mail (SPEC §7): the IMAP mailbox email-in reads. Request types
 * choose their own address; this panel only connects the mailbox and shows what arrived.
 */
export function IncomingMail() {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<InboxSettingsView>();
  const [messages, setMessages] = useState<InboundEmailView[]>([]);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [poll, setPoll] = useState<InboxPollResult>();
  const [polling, setPolling] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [view, log] = await Promise.all([api.inboxSettings(), api.inboundEmails()]);
      setSettings(view);
      setMessages(log);
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
        await api.updateInboxSettings({
          enabled: form.get('enabled') === 'on',
          host: text('host'),
          port: Number(text('port')),
          security: text('security') as InboxSettingsView['security'],
          verifyTls: form.get('verifyTls') === 'on',
          username: text('username'),
          folder: text('folder') || 'INBOX',
          // Write-only: an empty field keeps the stored password.
          ...(password ? { password } : {}),
        }),
      );
      clearSecretField(element, 'password');
      setSaved(true);
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  async function checkNow() {
    setPolling(true);
    setPoll(undefined);
    try {
      setPoll(await api.pollInbox());
      await reload();
    } catch (failure) {
      setError(t(errorKey(failure)));
    } finally {
      setPolling(false);
    }
  }

  if (!settings) return null;
  const formatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <Panel>
      <div className="flex flex-col gap-3 text-sm">
        <div>
          <h3 className="font-semibold text-ink">{t('admin.mail.inbox.title')}</h3>
          <p className="text-xs text-ink-muted">{t('admin.mail.inbox.subtitle')}</p>
        </div>
        <form
          onSubmit={save}
          aria-label={t('admin.mail.inbox.title')}
          className="flex flex-col gap-3"
        >
          <label className="flex items-center gap-2 text-ink-muted">
            <input type="checkbox" name="enabled" defaultChecked={settings.enabled} />
            {t('admin.mail.inbox.enabled')}
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              {t('admin.mail.inbox.host')}
              <input
                name="host"
                required
                defaultValue={settings.host ?? ''}
                placeholder="imap.company.com"
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
            <label className={labelClass}>
              {t('admin.mail.inbox.folder')}
              <input name="folder" defaultValue={settings.folder} className={inputClass} />
            </label>
            <label className={labelClass}>
              {t('admin.mail.inbox.username')}
              <input
                name="username"
                required
                autoComplete="off"
                defaultValue={settings.username ?? ''}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              {t('admin.mail.inbox.password')}
              <input
                name="password"
                type="password"
                autoComplete="off"
                placeholder={settings.passwordSet ? '••••••••' : ''}
                className={inputClass}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-ink-muted">
            <input type="checkbox" name="verifyTls" defaultChecked={settings.verifyTls} />
            {t('admin.mail.verifyTls')}
          </label>
          <FormError message={error} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={buttonClass}>
              {t('admin.mail.inbox.save')}
            </button>
            {settings.configured && (
              <button
                type="button"
                className={ghostButtonClass}
                disabled={polling}
                onClick={() => void checkNow()}
              >
                {t('admin.mail.inbox.checkNow')}
              </button>
            )}
            {saved && <span className="text-xs text-ink-muted">{t('admin.mail.inbox.saved')}</span>}
          </div>
        </form>

        {poll?.ok && (
          <p role="status" className="text-xs text-ink-muted">
            {t('admin.mail.inbox.processed', { count: poll.processed })}
          </p>
        )}
        {(poll && !poll.ok ? poll.error : settings.lastError) && (
          <div role="alert" className="flex flex-col gap-1 text-xs">
            <span className="text-red-600">{t('admin.mail.inbox.failed')}</span>
            <code className="rounded bg-hover p-2 font-mono text-ink">
              {poll && !poll.ok ? poll.error : settings.lastError}
            </code>
          </div>
        )}
        {settings.lastPollAt && (
          <p className="text-xs text-ink-faint">
            {t('admin.mail.inbox.lastPoll', {
              time: formatter.format(new Date(settings.lastPollAt)),
            })}
          </p>
        )}

        <h4 className="text-xs font-semibold text-ink">{t('admin.mail.inbox.recent')}</h4>
        {messages.length === 0 ? (
          <p className="text-xs text-ink-muted">{t('admin.mail.inbox.none')}</p>
        ) : (
          <ul
            aria-label={t('admin.mail.inbox.recent')}
            className="flex flex-col divide-y divide-line"
          >
            {messages.map((message) => (
              <li key={message.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-xs">
                <span className="text-ink-faint">
                  {formatter.format(new Date(message.receivedAt))}
                </span>
                <span className="text-ink">{message.from}</span>
                <span className="min-w-0 flex-1 truncate text-ink-muted">{message.subject}</span>
                {message.request ? (
                  <a
                    href={`/requests/${message.request.identifier}`}
                    className="text-accent hover:underline"
                  >
                    {message.request.identifier}
                  </a>
                ) : (
                  <span className="text-ink-muted">
                    {t(`admin.mail.inbox.status_${message.status}`)}
                    {message.reason && message.status === 'rejected'
                      ? ` · ${isKnownErrorCode(message.reason) ? t(`errors.${message.reason}`) : message.reason}`
                      : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
