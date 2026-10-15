import type { MeResponse, PublicStrategy } from '@ordler/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, GOOGLE_START_URL } from '../api/client.js';
import { errorKey, isKnownErrorCode } from './errors.js';
import { Card, FormError, PrimaryButton, TextField } from './form.js';

/** Renders exactly the strategies the admin enabled, in their order (SPEC §8.1). */
export function SignInPage({
  initialError,
  onSignedIn,
}: {
  initialError?: string | undefined;
  onSignedIn: (me: MeResponse) => void;
}) {
  const { t } = useTranslation();
  const [strategies, setStrategies] = useState<PublicStrategy[]>();
  const [error, setError] = useState<string | undefined>(() =>
    initialError
      ? t(isKnownErrorCode(initialError) ? `errors.${initialError}` : 'errors.unknown')
      : undefined,
  );

  useEffect(() => {
    api
      .strategies()
      .then(setStrategies)
      .catch((failure: unknown) => {
        setStrategies([]);
        setError(t(errorKey(failure)));
      });
  }, [t]);

  if (!strategies)
    return (
      <Card title={t('auth.title')} subtitle={t('auth.loading')}>
        {null}
      </Card>
    );

  const sections = strategies.map((strategy) => {
    switch (strategy.kind) {
      case 'local':
        return <PasswordForm key="local" onSignedIn={onSignedIn} onError={setError} />;
      case 'email_otp':
        return <OtpForm key="email_otp" onSignedIn={onSignedIn} onError={setError} />;
      case 'google':
        return (
          <a
            key="google"
            href={GOOGLE_START_URL}
            className="rounded-md border border-line px-3 py-2 text-center text-sm font-medium text-ink hover:bg-hover"
          >
            {strategy.displayName ?? t('auth.google')}
          </a>
        );
    }
  });

  return (
    <Card title={t('auth.title')}>
      <FormError message={error} />
      {sections.length === 0 && <p className="text-sm text-ink-muted">{t('auth.noStrategies')}</p>}
      {sections.flatMap((section, index) =>
        index === 0
          ? [section]
          : [
              <p key={`or-${index}`} className="text-center text-xs text-ink-faint">
                {t('auth.or')}
              </p>,
              section,
            ],
      )}
    </Card>
  );
}

function PasswordForm({
  onSignedIn,
  onError,
}: {
  onSignedIn: (me: MeResponse) => void;
  onError: (message: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    onError(undefined);
    try {
      onSignedIn(
        await api.signInWithPassword(String(form.get('email')), String(form.get('password'))),
      );
    } catch (failure) {
      onError(t(errorKey(failure)));
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit} aria-label={t('auth.password')}>
      <TextField
        label={t('auth.email')}
        name="email"
        type="email"
        required
        autoComplete="username"
      />
      <TextField
        label={t('auth.password')}
        name="password"
        type="password"
        required
        autoComplete="current-password"
      />
      <PrimaryButton type="submit" disabled={busy}>
        {busy ? t('auth.signingIn') : t('auth.signIn')}
      </PrimaryButton>
    </form>
  );
}

function OtpForm({
  onSignedIn,
  onError,
}: {
  onSignedIn: (me: MeResponse) => void;
  onError: (message: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get('email'));
    setBusy(true);
    onError(undefined);
    try {
      await api.requestOtp(value);
      setEmail(value);
    } catch (failure) {
      onError(t(errorKey(failure)));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code'));
    setBusy(true);
    onError(undefined);
    try {
      onSignedIn(await api.verifyOtp(email!, code));
    } catch (failure) {
      onError(t(errorKey(failure)));
      setBusy(false);
    }
  }

  if (!email) {
    return (
      <form className="flex flex-col gap-3" onSubmit={requestCode} aria-label={t('auth.otpSend')}>
        <TextField
          label={t('auth.email')}
          name="email"
          type="email"
          required
          autoComplete="email"
        />
        <PrimaryButton type="submit" disabled={busy}>
          {t('auth.otpSend')}
        </PrimaryButton>
      </form>
    );
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={verify} aria-label={t('auth.verify')}>
      <p className="text-sm text-ink-muted">{t('auth.otpSent', { email })}</p>
      <TextField
        label={t('auth.code')}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
      />
      <PrimaryButton type="submit" disabled={busy}>
        {t('auth.verify')}
      </PrimaryButton>
      <button
        type="button"
        className="text-xs text-ink-muted underline"
        onClick={() => setEmail(undefined)}
      >
        {t('auth.useAnotherEmail')}
      </button>
    </form>
  );
}
