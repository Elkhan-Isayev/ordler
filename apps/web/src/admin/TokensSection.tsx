import type { PersonalTokenView, TokenSettings } from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { TokenRow } from '../settings/TokensPage.js';
import { buttonClass, inputClass, Panel, SectionHeader } from './common.js';

/** Admin → Access tokens and MCP (SPEC §10.1): the MCP switch, expiry limits, every token. */
export function TokensSection() {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<PersonalTokenView[]>();
  const [settings, setSettings] = useState<TokenSettings>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await api.allTokens();
      setTokens(data.tokens);
      setSettings(data.settings);
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(undefined);
    setSaved(false);
    try {
      setSettings(
        await api.updateTokenSettings({
          mcpEnabled: form.get('mcpEnabled') === 'on',
          maxExpiryDays: Number(form.get('maxExpiryDays')),
          allowNoExpiry: form.get('allowNoExpiry') === 'on',
        }),
      );
      setSaved(true);
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  async function revoke(token: PersonalTokenView) {
    try {
      await api.adminRevokeToken(token.id);
      await reload();
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={t('admin.tokens.title')} subtitle={t('admin.tokens.subtitle')} />
      {error && <FormError message={error} />}
      {settings && (
        <Panel>
          <form
            aria-label={t('admin.tokens.settings')}
            onSubmit={(event) => void save(event)}
            className="flex flex-col gap-3"
          >
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="mcpEnabled" defaultChecked={settings.mcpEnabled} />
              {t('admin.tokens.mcpEnabled')}
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              {t('admin.tokens.maxExpiryDays')}
              <input
                name="maxExpiryDays"
                type="number"
                min={1}
                max={3650}
                required
                defaultValue={settings.maxExpiryDays}
                className={`${inputClass} w-32`}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="allowNoExpiry" defaultChecked={settings.allowNoExpiry} />
              {t('admin.tokens.allowNoExpiry')}
            </label>
            <div className="flex items-center gap-3">
              <button type="submit" className={buttonClass}>
                {t('admin.tokens.save')}
              </button>
              {saved && (
                <span role="status" className="text-xs text-ink-muted">
                  {t('admin.tokens.saved')}
                </span>
              )}
            </div>
          </form>
        </Panel>
      )}
      <Panel>
        <h3 className="text-sm font-semibold text-ink">{t('admin.tokens.all')}</h3>
        {tokens?.length === 0 && <p className="text-sm text-ink-muted">{t('tokens.empty')}</p>}
        <ul className="flex flex-col divide-y divide-line">
          {tokens?.map((token) => (
            <TokenRow key={token.id} token={token} showMember onRevoke={(x) => void revoke(x)} />
          ))}
        </ul>
      </Panel>
    </div>
  );
}
