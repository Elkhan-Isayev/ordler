import type { SlackLinkView } from '@ordler/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, SLACK_LINK_URL } from '../api/client.js';
import { errorKey, isKnownErrorCode } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { buttonClass, ghostButtonClass } from '../admin/common.js';

/** Settings → Slack (SPEC §7.1): link the member's Slack account and choose DMs. */
export function SlackPage() {
  const { t } = useTranslation();
  const [link, setLink] = useState<SlackLinkView>();
  // The OAuth callback reports back in the query string once.
  const [notice] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const failed = params.get('slack_error');
    if (failed)
      return {
        error: true,
        text: isKnownErrorCode(failed) ? `errors.${failed}` : 'errors.unknown',
      };
    return params.get('slack') === 'linked'
      ? { error: false, text: 'slack.linkedNotice' }
      : undefined;
  });
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setLink(await api.mySlack());
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(action: () => Promise<unknown>) {
    setError(undefined);
    try {
      await action();
      await reload();
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  return (
    <section className="flex max-w-xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">{t('slack.title')}</h1>
        <p className="text-sm text-ink-muted">{t('slack.subtitle')}</p>
      </div>
      {notice &&
        (notice.error ? (
          <FormError message={t(notice.text)} />
        ) : (
          <p role="status" className="text-sm text-ink-muted">
            {t(notice.text)}
          </p>
        ))}
      <FormError message={error} />
      {link && !link.available && !link.linked && (
        <p className="text-sm text-ink-muted">{t('slack.unavailable')}</p>
      )}
      {link?.linked ? (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-ink">{t('slack.linkedTo', { workspace: link.workspace ?? '' })}</p>
          <label className="flex items-center gap-2 text-ink-muted">
            <input
              type="checkbox"
              checked={link.directMessages}
              onChange={(event) => void run(() => api.updateMySlack(event.target.checked))}
            />
            {t('slack.directMessages')}
          </label>
          <div>
            <button
              type="button"
              className={ghostButtonClass}
              onClick={() => void run(() => api.unlinkSlack())}
            >
              {t('slack.unlink')}
            </button>
          </div>
        </div>
      ) : (
        link?.available && (
          <div>
            <a href={SLACK_LINK_URL} className={buttonClass}>
              {t('slack.link', { workspace: link.workspace ?? '' })}
            </a>
          </div>
        )
      )}
    </section>
  );
}
