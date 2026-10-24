import {
  DEFAULT_TOKEN_EXPIRY_DAYS,
  TOKEN_SCOPES,
  type PersonalTokenView,
  type TokenScope,
  type TokenSettings,
} from '@ordler/shared';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buttonClass,
  ghostButtonClass,
  inputClass,
  Panel,
  SectionHeader,
} from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { formatWhen } from '../issues/Comments.js';

const labelClass = 'flex flex-col gap-1 text-xs text-ink-muted';

/** i18next reads ":" as a namespace separator, so `issues:write` becomes `issuesWrite`. */
export const scopeKey = (scope: TokenScope) =>
  scope.replace(/:(\w)/, (_, c: string) => c.toUpperCase());
const EXPIRY_CHOICES = [30, 90, 365];

/** Active, expired or revoked, as shown next to each token. */
export function tokenState(token: PersonalTokenView, now = new Date()) {
  if (token.revokedAt) return 'revoked';
  if (token.expiresAt && new Date(token.expiresAt) <= now) return 'expired';
  return 'active';
}

export function TokenRow({
  token,
  onRevoke,
  showMember = false,
}: {
  token: PersonalTokenView;
  onRevoke: (token: PersonalTokenView) => void;
  showMember?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const state = tokenState(token);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
      <span className="font-medium text-ink">{token.name}</span>
      {showMember && token.member && <span className="text-ink-muted">{token.member.name}</span>}
      <code className="text-xs text-ink-faint">{token.prefix}…</code>
      <span className="text-xs text-ink-muted">
        {token.scopes.map((s) => t(`tokens.scopes.${scopeKey(s)}`)).join(', ')}
      </span>
      <span className="text-xs text-ink-faint">{usage(t, token, i18n.language)}</span>
      <span className="ml-auto flex items-center gap-2">
        <span className="text-xs text-ink-muted">{t(`tokens.state.${state}`)}</span>
        {state === 'active' && (
          <button
            type="button"
            className={ghostButtonClass}
            aria-label={t('tokens.revokeNamed', { name: token.name })}
            onClick={() => onRevoke(token)}
          >
            {t('tokens.revoke')}
          </button>
        )}
      </span>
    </li>
  );
}

function usage(t: TFunction, token: PersonalTokenView, language: string): string {
  const parts = [
    token.expiresAt
      ? t('tokens.expires', { date: formatWhen(token.expiresAt, language) })
      : t('tokens.noExpiry'),
    token.lastUsedAt
      ? t('tokens.lastUsed', {
          date: formatWhen(token.lastUsedAt, language),
          ip: token.lastUsedIp ?? '—',
        })
      : t('tokens.neverUsed'),
  ];
  return parts.join(' · ');
}

/**
 * Settings → Access tokens (SPEC §10.1): members create tokens for AI agents and MCP clients.
 * The secret is shown once; afterwards only its prefix.
 */
export function TokensPage({ baseUrl = window.location.origin }: { baseUrl?: string }) {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<PersonalTokenView[]>();
  const [settings, setSettings] = useState<TokenSettings>();
  const [secret, setSecret] = useState<string>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      const data = await api.myTokens();
      setTokens(data.tokens);
      setSettings(data.settings);
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const expiry = String(form.get('expiry'));
    setError(undefined);
    try {
      const created = await api.createToken({
        name: String(form.get('name') ?? '').trim(),
        scopes: TOKEN_SCOPES.filter((s) => form.get(`scope:${s}`) === 'on') as TokenScope[],
        expiresInDays: expiry === 'never' ? null : Number(expiry),
      });
      setSecret(created.token);
      element.reset();
      await reload();
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  async function revoke(token: PersonalTokenView) {
    try {
      await api.revokeToken(token.id);
      await reload();
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  const choices = EXPIRY_CHOICES.filter((days) => !settings || days <= settings.maxExpiryDays);

  return (
    <div className="flex max-w-3xl flex-col gap-4 p-6">
      <SectionHeader title={t('tokens.title')} subtitle={t('tokens.subtitle')} />
      {error && <FormError message={error} />}
      {settings && !settings.mcpEnabled && (
        <p className="text-sm text-ink-muted">{t('tokens.mcpDisabled')}</p>
      )}
      {secret && (
        <Panel>
          <p role="status" className="text-sm font-medium text-ink">
            {t('tokens.created')}
          </p>
          <code className="break-all rounded-md bg-hover px-2 py-1 text-sm text-ink">{secret}</code>
          <div className="flex gap-2">
            <button
              type="button"
              className={ghostButtonClass}
              onClick={() => void navigator.clipboard?.writeText(secret)}
            >
              {t('tokens.copy')}
            </button>
            <button type="button" className={ghostButtonClass} onClick={() => setSecret(undefined)}>
              {t('tokens.done')}
            </button>
          </div>
        </Panel>
      )}
      <Panel>
        <h3 className="text-sm font-semibold text-ink">{t('tokens.connect')}</h3>
        <p className="text-sm text-ink-muted">{t('tokens.connectHint')}</p>
        <code className="rounded-md bg-hover px-2 py-1 text-sm text-ink">{`${baseUrl}/mcp`}</code>
        <p className="text-sm text-ink-muted">{t('tokens.restHint')}</p>
        <code className="rounded-md bg-hover px-2 py-1 text-sm text-ink">{`${baseUrl}/api/v1`}</code>
        <a
          href="/api/v1/openapi.json"
          target="_blank"
          rel="noopener"
          className="text-sm text-accent hover:underline"
        >
          {t('tokens.openApi')}
        </a>
      </Panel>
      <Panel>
        <h3 className="text-sm font-semibold text-ink">{t('tokens.yours')}</h3>
        {tokens?.length === 0 && <p className="text-sm text-ink-muted">{t('tokens.empty')}</p>}
        <ul className="flex flex-col divide-y divide-line">
          {tokens?.map((token) => (
            <TokenRow key={token.id} token={token} onRevoke={(x) => void revoke(x)} />
          ))}
        </ul>
      </Panel>
      <Panel>
        <form
          aria-label={t('tokens.new')}
          onSubmit={(event) => void create(event)}
          className="flex flex-col gap-3"
        >
          <h3 className="text-sm font-semibold text-ink">{t('tokens.new')}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className={labelClass}>
              {t('tokens.name')}
              <input
                name="name"
                required
                maxLength={80}
                placeholder="Claude"
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              {t('tokens.expiry')}
              <select
                name="expiry"
                defaultValue={String(DEFAULT_TOKEN_EXPIRY_DAYS)}
                className={inputClass}
              >
                {choices.map((days) => (
                  <option key={days} value={days}>
                    {t('tokens.days', { count: days })}
                  </option>
                ))}
                {settings?.allowNoExpiry && <option value="never">{t('tokens.noExpiry')}</option>}
              </select>
            </label>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs text-ink-muted">{t('tokens.scopesLabel')}</legend>
            {TOKEN_SCOPES.map((scope) => (
              <label key={scope} className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name={`scope:${scope}`}
                  defaultChecked={scope === 'read'}
                  className="mt-1"
                />
                <span>
                  {t(`tokens.scopes.${scopeKey(scope)}`)}
                  <span className="block text-xs text-ink-faint">
                    {t(`tokens.scopeHints.${scopeKey(scope)}`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-ink-faint">{t('tokens.approvalsNote')}</p>
          <div>
            <button type="submit" className={buttonClass}>
              {t('tokens.create')}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
