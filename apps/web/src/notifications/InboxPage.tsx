import { memberTopic, type InboxCounts, type NotificationView } from '@ordler/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { formatWhen } from '../issues/Comments.js';
import { useRealtime } from '../realtime/client.js';
import { Link } from '../router.js';

const EMPTY: InboxCounts = { unread: 0, approvals: 0 };

/** Sidebar badges, refreshed live through the member's own topic. */
export function useInboxCounts(memberId: string): InboxCounts {
  const [counts, setCounts] = useState<InboxCounts>(EMPTY);
  const reload = useCallback(() => {
    api
      .inboxCounts()
      .then(setCounts)
      .catch(() => undefined);
  }, []);
  useEffect(reload, [reload]);
  useRealtime(
    memberTopic(memberId),
    (message) => {
      if (message.type === 'inbox.changed' || message.type === 'request.changed') reload();
    },
    reload,
  );
  return counts;
}

/** Everything that happened to me (SPEC §7): newest first, unread highlighted. */
export function InboxPage({ memberId }: { memberId: string }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<NotificationView[]>();
  const [error, setError] = useState<string>();

  const reload = useCallback(() => {
    api
      .notifications()
      .then((list) => {
        setItems(list);
        setError(undefined);
      })
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, []);
  useEffect(reload, [reload]);
  useRealtime(
    memberTopic(memberId),
    (message) => {
      if (message.type === 'inbox.changed') reload();
    },
    reload,
  );

  async function mark(ids: string[] | undefined, read: boolean) {
    setItems((current) =>
      current?.map((item) => (!ids || ids.includes(item.id) ? { ...item, read } : item)),
    );
    try {
      await api.markNotifications({ ...(ids ? { ids } : {}), read });
    } catch (failure) {
      setError(errorKey(failure));
      reload();
    }
  }

  const unread = items?.filter((item) => !item.read).length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h1 className="text-sm font-semibold text-ink">{t('nav.inbox')}</h1>
        <button
          type="button"
          disabled={unread === 0}
          onClick={() => void mark(undefined, true)}
          className="ml-auto rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-hover hover:text-ink disabled:opacity-50"
        >
          {t('inbox.markAllRead')}
        </button>
      </header>
      {error && (
        <div className="p-4">
          <FormError message={t(error)} />
        </div>
      )}
      {items?.length === 0 && (
        <p className="p-8 text-center text-sm text-ink-muted">{t('inbox.empty')}</p>
      )}
      <ul>
        {items?.map((item) => (
          <li
            key={item.id}
            className={`flex items-center gap-3 border-b border-line px-4 py-2 text-sm ${
              item.read ? '' : 'bg-accent/5'
            }`}
          >
            <span
              aria-hidden
              className={`size-2 shrink-0 rounded-full ${item.read ? 'bg-transparent' : 'bg-accent'}`}
            />
            <Link
              href={item.subject.path}
              onClick={() => {
                if (!item.read) void mark([item.id], true);
              }}
              className="flex min-w-0 flex-1 flex-col hover:underline"
            >
              <span className={item.read ? 'text-ink-muted' : 'font-medium text-ink'}>
                {t(`inbox.kinds.${item.kind}`, {
                  actor: item.actor?.name ?? t('inbox.someone'),
                  item: item.subject.identifier,
                })}
              </span>
              <span className="truncate text-xs text-ink-faint">{item.subject.title}</span>
            </Link>
            <span className="hidden text-xs text-ink-faint sm:inline">
              {formatWhen(item.createdAt, i18n.language)}
            </span>
            <button
              type="button"
              onClick={() => void mark([item.id], !item.read)}
              className="rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-hover hover:text-ink"
            >
              {item.read ? t('inbox.markUnread') : t('inbox.markRead')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
