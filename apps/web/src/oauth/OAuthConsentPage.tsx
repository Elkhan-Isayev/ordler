import type { OAuthAuthorizeQuery, OAuthConsentView, TokenScope } from '@ordler/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { Card, FormError } from '../auth/form.js';
import { scopeKey } from '../settings/TokensPage.js';
import { buttonClass, ghostButtonClass } from '../admin/common.js';

/**
 * Consent for an MCP client (SPEC §10.1): the member sees who asks, where the answer goes and
 * which scopes, may narrow them, and decides. The decision comes back as a redirect URL.
 */
export function OAuthConsentPage({
  search,
  go = (url) => window.location.assign(url),
}: {
  search: string;
  go?: (url: string) => void;
}) {
  const { t } = useTranslation();
  const [query] = useState(() => Object.fromEntries(new URLSearchParams(search)));
  const [view, setView] = useState<OAuthConsentView>();
  const [chosen, setChosen] = useState<TokenScope[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.oauthConsent(query).then(
      (found) => {
        setView(found);
        setChosen(found.scopes);
      },
      (failure: unknown) => setError(t(errorKey(failure))),
    );
  }, [query, t]);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      // The query was validated by the server when the page loaded; it is sent back as is.
      const { redirect } = await api.oauthDecide({
        ...(query as unknown as OAuthAuthorizeQuery),
        approve,
        scopes: chosen,
      });
      go(redirect);
    } catch (failure) {
      setError(t(errorKey(failure)));
      setBusy(false);
    }
  }

  if (!view) {
    return (
      <Card title={t('oauth.title')}>
        <FormError message={error} />
      </Card>
    );
  }
  return (
    <Card title={t('oauth.title')} subtitle={t('oauth.asks', { client: view.client.name })}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-ink-muted">{t('oauth.redirect', { host: view.redirectHost })}</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs text-ink-muted">{t('oauth.scopes')}</legend>
          {view.scopes.map((scope) => (
            <label key={scope} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={chosen.includes(scope)}
                onChange={(event) =>
                  setChosen((current) =>
                    event.target.checked ? [...current, scope] : current.filter((s) => s !== scope),
                  )
                }
              />
              <span>
                <span className="text-ink">{t(`tokens.scopes.${scopeKey(scope)}`)}</span>
                <span className="block text-xs text-ink-faint">
                  {t(`tokens.scopeHints.${scopeKey(scope)}`)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-ink-faint">{t('oauth.warning')}</p>
        <FormError message={error} />
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={busy || chosen.length === 0}
            onClick={() => void decide(true)}
          >
            {t('oauth.allow')}
          </button>
          <button
            type="button"
            className={ghostButtonClass}
            disabled={busy}
            onClick={() => void decide(false)}
          >
            {t('oauth.deny')}
          </button>
        </div>
      </div>
    </Card>
  );
}
