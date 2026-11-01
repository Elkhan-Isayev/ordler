import {
  SUPPORTED_LOCALES,
  type EmailTemplateKey,
  type EmailTemplateView,
  type Locale,
} from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { LOCALE_NAMES } from '../i18n/index.js';
import { buttonClass, ghostButtonClass, inputClass, Panel } from './common.js';

const labelClass = 'flex flex-col gap-1 text-xs text-ink-muted';

/** Admin → Mail → Email templates (SPEC §8.2): reword built-in emails per language. */
export function EmailTemplates() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<EmailTemplateView[]>();
  const [key, setKey] = useState<EmailTemplateKey>('otp');
  const [locale, setLocale] = useState<Locale>('en');
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setTemplates(await api.emailTemplates());
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const template = templates?.find((item) => item.key === key);
  const text = template?.locales[locale];

  return (
    <Panel>
      <div className="flex flex-col gap-3 text-sm">
        <div>
          <h3 className="font-semibold text-ink">{t('admin.mail.templates.title')}</h3>
          <p className="text-xs text-ink-muted">{t('admin.mail.templates.subtitle')}</p>
        </div>
        <FormError message={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            {t('admin.mail.templates.template')}
            <select
              value={key}
              onChange={(event) => setKey(event.target.value as EmailTemplateKey)}
              className={inputClass}
            >
              {templates?.map((item) => (
                <option key={item.key} value={item.key}>
                  {t(`admin.mail.templates.name_${item.key}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {t('admin.mail.templates.language')}
            <select
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
              className={inputClass}
            >
              {SUPPORTED_LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_NAMES[code]}
                  {template?.locales[code]?.customized
                    ? ` · ${t('admin.mail.templates.customized')}`
                    : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        {template && text && (
          // Remount per template and language so the fields show that text, not stale edits.
          <TemplateEditor
            key={`${key}-${locale}`}
            template={template}
            locale={locale}
            onChanged={setTemplates}
          />
        )}
      </div>
    </Panel>
  );
}

function TemplateEditor({
  template,
  locale,
  onChanged,
}: {
  template: EmailTemplateView;
  locale: Locale;
  onChanged: (templates: EmailTemplateView[]) => void;
}) {
  const { t } = useTranslation();
  const text = template.locales[locale]!;
  const [subject, setSubject] = useState(text.subject);
  const [body, setBody] = useState(text.body);
  const [preview, setPreview] = useState<{ subject: string; text: string }>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  async function run(action: () => Promise<void>) {
    setError(undefined);
    setSaved(false);
    try {
      await action();
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      onChanged(await api.saveEmailTemplate(template.key, locale, { subject, body }));
      setSaved(true);
    });
  }

  function reset() {
    void run(async () => {
      onChanged(await api.resetEmailTemplate(template.key, locale));
      setSubject(text.default.subject);
      setBody(text.default.body);
      setPreview(undefined);
    });
  }

  return (
    <form
      onSubmit={save}
      aria-label={t('admin.mail.templates.title')}
      className="flex flex-col gap-3"
    >
      <p className="text-xs text-ink-muted">
        {t('admin.mail.templates.variables')}{' '}
        {template.variables.map((name) => (
          <code key={name} className="mr-1 rounded bg-hover px-1 font-mono text-ink">
            {`{${name}}`}
          </code>
        ))}
        {template.required.length > 0 &&
          t('admin.mail.templates.required', {
            names: template.required.map((name) => `{${name}}`).join(', '),
          })}
      </p>
      <label className={labelClass}>
        {t('admin.mail.templates.subject')}
        <input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          required
          maxLength={300}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t('admin.mail.templates.body')}
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          required
          rows={8}
          maxLength={10_000}
          className={`${inputClass} font-mono text-xs`}
        />
      </label>
      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={buttonClass}>
          {t('admin.mail.templates.save')}
        </button>
        <button
          type="button"
          className={ghostButtonClass}
          onClick={() =>
            void run(async () =>
              setPreview(await api.previewEmailTemplate(template.key, locale, { subject, body })),
            )
          }
        >
          {t('admin.mail.templates.preview')}
        </button>
        {text.customized && (
          <button type="button" className={ghostButtonClass} onClick={reset}>
            {t('admin.mail.templates.reset')}
          </button>
        )}
        {saved && <span className="text-xs text-ink-muted">{t('admin.mail.templates.saved')}</span>}
      </div>
      {preview && (
        <section
          aria-label={t('admin.mail.templates.preview')}
          className="rounded-md border border-line p-3 text-xs"
        >
          <p className="font-semibold text-ink">{preview.subject}</p>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-ink-muted">{preview.text}</pre>
        </section>
      )}
    </form>
  );
}
