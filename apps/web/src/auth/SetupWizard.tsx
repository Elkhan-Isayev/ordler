import {
  PASSWORD_MIN_LENGTH,
  SUPPORTED_LOCALES,
  type Locale,
  type MeResponse,
} from '@ordler/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { LOCALE_NAMES } from '../i18n/index.js';
import { errorKey } from './errors.js';
import { Card, FormError, PrimaryButton, TextField } from './form.js';

/** First-run wizard (SPEC §16.4): workspace name, default language and the first Owner. */
export function SetupWizard({
  initialLocale,
  onComplete,
}: {
  initialLocale: Locale;
  onComplete: (me: MeResponse) => void;
}) {
  const { t, i18n } = useTranslation();
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password'));
    if (password.length < PASSWORD_MIN_LENGTH) return setError(t('errors.password_too_short'));
    if (password !== String(form.get('passwordConfirm'))) {
      return setError(t('errors.password_mismatch'));
    }
    setError(undefined);
    setSubmitting(true);
    try {
      const me = await api.completeSetup({
        companyName: String(form.get('companyName')),
        defaultLocale: locale,
        owner: { name: String(form.get('name')), email: String(form.get('email')), password },
      });
      onComplete(me);
    } catch (failure) {
      setError(t(errorKey(failure)));
      setSubmitting(false);
    }
  }

  return (
    <Card title={t('setup.title')} subtitle={t('setup.subtitle')}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <TextField label={t('setup.companyName')} name="companyName" required maxLength={120} />
        <div className="flex flex-col gap-1">
          <label htmlFor="setup-locale" className="text-xs font-medium text-ink-muted">
            {t('setup.defaultLanguage')}
          </label>
          <select
            id="setup-locale"
            value={locale}
            onChange={(event) => {
              const next = event.target.value as Locale;
              setLocale(next);
              void i18n.changeLanguage(next);
            }}
            className="rounded-md border border-line bg-card px-3 py-2 text-sm text-ink"
          >
            {SUPPORTED_LOCALES.map((code) => (
              <option key={code} value={code}>
                {LOCALE_NAMES[code]}
              </option>
            ))}
          </select>
        </div>
        <h2 className="pt-2 text-sm font-semibold text-ink">{t('setup.ownerSection')}</h2>
        <TextField label={t('setup.name')} name="name" required autoComplete="name" />
        <TextField
          label={t('setup.email')}
          name="email"
          type="email"
          required
          autoComplete="email"
        />
        <TextField
          label={t('setup.password')}
          name="password"
          type="password"
          required
          autoComplete="new-password"
          hint={t('setup.passwordHint', { min: PASSWORD_MIN_LENGTH })}
        />
        <TextField
          label={t('setup.passwordConfirm')}
          name="passwordConfirm"
          type="password"
          required
          autoComplete="new-password"
        />
        <FormError message={error} />
        <PrimaryButton type="submit" disabled={submitting}>
          {submitting ? t('setup.submitting') : t('setup.submit')}
        </PrimaryButton>
      </form>
    </Card>
  );
}
