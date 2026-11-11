import { whiteboardTopic, type MemberRef, type WhiteboardView } from '@ordler/shared';
import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { AvatarStack, quietSelectClass } from '../issues/ui.js';
import { useRealtime } from '../realtime/client.js';
import { Link, navigate } from '../router.js';
import type { CanvasHandle } from './WhiteboardCanvas.js';
import { LazyCanvas } from './LazyCanvas.js';
import { TEMPLATE_KEYS, TEMPLATE_LABELS, type TemplateKey } from './templates.js';

/** One whiteboard on the whole screen (/whiteboards/:id), edited live with the team. */
export function WhiteboardPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const [board, setBoard] = useState<WhiteboardView>();
  const [missing, setMissing] = useState(false);
  const [people, setPeople] = useState<MemberRef[]>([]);
  const [error, setError] = useState<string>();
  const canvas = useRef<CanvasHandle | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      setBoard(await api.whiteboard(id));
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 404) setMissing(true);
      else setError(t(errorKey(failure)));
    }
  }, [id, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useRealtime(
    board ? whiteboardTopic(id) : undefined,
    (message) => {
      if (message.type === 'whiteboard.changed' && message.whiteboardId === id) void reload();
    },
    () => void reload(),
  );

  async function rename(title: string) {
    if (!board || !title.trim() || title === board.title) return;
    try {
      setBoard(await api.renameWhiteboard(id, title.trim()));
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  async function remove() {
    if (!board || !window.confirm(t('whiteboards.confirmDelete', { title: board.title }))) return;
    try {
      await api.deleteWhiteboard(id);
      navigate('/whiteboards');
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  function insert(key: TemplateKey) {
    const labels = Object.fromEntries(
      TEMPLATE_LABELS[key].map((name) => [name, t(`whiteboards.labels.${name}`)]),
    );
    canvas.current?.insertTemplate(key, labels);
  }

  if (missing) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-ink-muted">{t('whiteboards.missing')}</p>
        <Link href="/whiteboards" className="text-accent hover:underline">
          {t('nav.whiteboards')}
        </Link>
      </main>
    );
  }
  if (!board) return error ? <FormError message={error} /> : null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2">
        <Link href="/whiteboards" className="text-xs text-ink-muted hover:underline">
          {board.team.key}
        </Link>
        {board.canManage ? (
          <input
            key={board.title}
            defaultValue={board.title}
            aria-label={t('whiteboards.titleLabel')}
            maxLength={200}
            className="min-w-0 rounded-md bg-transparent px-1 text-sm font-semibold text-ink hover:bg-hover focus:bg-hover focus:outline-none"
            onBlur={(event) => void rename(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        ) : (
          <h1 className="text-sm font-semibold text-ink">{board.title}</h1>
        )}
        {!board.canEdit && (
          <span className="rounded-full bg-hover px-2 py-0.5 text-xs text-ink-muted">
            {t('whiteboards.readOnly')}
          </span>
        )}
        {board.issues.length > 0 && (
          <span className="flex flex-wrap items-center gap-1 text-xs text-ink-muted">
            {t('whiteboards.onIssues')}
            {board.issues.map((issue) => (
              <Link
                key={issue.identifier}
                href={`/issue/${issue.identifier}`}
                title={issue.title}
                className="rounded bg-hover px-1.5 py-0.5 font-mono text-ink hover:underline"
              >
                {issue.identifier}
              </Link>
            ))}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {people.length > 0 && (
            <span aria-label={t('whiteboards.here', { count: people.length })}>
              <AvatarStack members={people} />
            </span>
          )}
          {board.canEdit && (
            <select
              aria-label={t('whiteboards.insert')}
              value=""
              className={quietSelectClass}
              onChange={(event) => {
                if (event.target.value) insert(event.target.value as TemplateKey);
              }}
            >
              <option value="">{t('whiteboards.insert')}</option>
              {TEMPLATE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {t(`whiteboards.templates.${key}`)}
                </option>
              ))}
            </select>
          )}
          {board.canManage && (
            <button
              type="button"
              aria-label={t('whiteboards.delete')}
              className="rounded-md p-1.5 text-ink-faint hover:bg-hover hover:text-ink"
              onClick={() => void remove()}
            >
              <Trash2 aria-hidden size={14} />
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className="px-4 pt-2">
          <FormError message={error} />
        </div>
      )}
      <div className="relative min-h-[400px] flex-1">
        <div className="absolute inset-0">
          <LazyCanvas
            board={board}
            onReady={(handle) => (canvas.current = handle)}
            onPeople={setPeople}
            onError={(failure) => setError(t(errorKey(failure)))}
          />
        </div>
      </div>
    </div>
  );
}
