import { resolveLocale, type Locale, type MeResponse } from '@ordler/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client.js';
import { App } from '../App.js';
import { errorKey } from './errors.js';
import { Card } from './form.js';
import { SetupWizard } from './SetupWizard.js';
import { SignInPage } from './SignInPage.js';

type GateState =
  | { kind: 'loading' }
  | { kind: 'failed'; messageKey: string }
  | { kind: 'setup' }
  | { kind: 'signIn'; error?: string | undefined }
  | { kind: 'app'; me: MeResponse };

/** Reads and strips `?auth_error=` left by the Google callback redirect. */
export function takeAuthError(
  location: Pick<Location, 'search' | 'pathname' | 'hash'>,
): string | undefined {
  const params = new URLSearchParams(location.search);
  const code = params.get('auth_error') ?? undefined;
  if (code) {
    params.delete('auth_error');
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      `${location.pathname}${query ? `?${query}` : ''}${location.hash}`,
    );
  }
  return code;
}

/** Decides what to show: setup wizard, sign-in, or the app for a signed-in member. */
export function AuthGate({ browserLocale }: { browserLocale: Locale }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<GateState>({ kind: 'loading' });

  const enterApp = useCallback(
    (me: MeResponse) => {
      const locale = resolveLocale({
        userPreference: me.member.locale,
        instanceDefault: me.workspace.defaultLocale,
        acceptLanguage: browserLocale,
      });
      void i18n.changeLanguage(locale);
      document.documentElement.lang = locale;
      setState({ kind: 'app', me });
    },
    [browserLocale, i18n],
  );

  useEffect(() => {
    let cancelled = false;
    const authError = takeAuthError(window.location);
    (async () => {
      try {
        const { setupRequired } = await api.setupStatus();
        if (cancelled) return;
        if (setupRequired) return setState({ kind: 'setup' });
        try {
          const me = await api.me();
          if (!cancelled) enterApp(me);
        } catch (error) {
          if (cancelled) return;
          if (error instanceof ApiError && error.status === 401) {
            setState({ kind: 'signIn', error: authError });
          } else throw error;
        }
      } catch (error) {
        if (!cancelled) setState({ kind: 'failed', messageKey: errorKey(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once per mount: re-running on language changes would undo a sign-out.
  }, [enterApp]);

  async function signOut() {
    await api.signOut().catch(() => undefined);
    setState({ kind: 'signIn' });
  }

  switch (state.kind) {
    case 'loading':
      return (
        <Card title="Ordler" subtitle={t('auth.loading')}>
          {null}
        </Card>
      );
    case 'failed':
      return (
        <Card title="Ordler" subtitle={t(state.messageKey)}>
          {null}
        </Card>
      );
    case 'setup':
      return <SetupWizard initialLocale={browserLocale} onComplete={enterApp} />;
    case 'signIn':
      return <SignInPage initialError={state.error} onSignedIn={enterApp} />;
    case 'app':
      return <App me={state.me} onSignOut={signOut} />;
  }
}
