import type { IssueDetail, TeamView, WhiteboardSummary } from '@ordler/shared';
import { Maximize2, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ghostButtonClass } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { quietSelectClass } from '../issues/ui.js';
import { Link, navigate } from '../router.js';
import { LazyCanvas } from './LazyCanvas.js';

/**
 * Whiteboards attached to an issue (SPEC §5.5), each shown live right in the issue: changes
 * and other people's pointers appear as they happen; "Open" edits it on the whole screen.
 */
export function IssueWhiteboards({
  issue,
  team,
  onError,
}: {
  issue: Pick<IssueDetail, 'identifier' | 'title'>;
  team: Pick<TeamView, 'key' | 'can'>;
  onError: (code: string) => void;
}) {
  const { t } = useTranslation();
  const [boards, setBoards] = useState<WhiteboardSummary[]>();
  const [choices, setChoices] = useState<WhiteboardSummary[]>();

  const reload = useCallback(async () => {
    try {
      setBoards(await api.issueWhiteboards(issue.identifier));
    } catch (failure) {
      onError(errorKey(failure));
    }
  }, [issue.identifier, onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (failure) {
      onError(errorKey(failure));
    }
  }

  const canAttach = team.can.update;
  const attached = new Set(boards?.map((b) => b.id));

  return (
    <section aria-label={t('whiteboards.section')} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">{t('whiteboards.section')}</h2>
        {canAttach && (
          <div className="ml-auto flex items-center gap-2">
            {team.can.whiteboards && (
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() =>
                  void run(async () => {
                    const board = await api.createWhiteboard({
                      team: team.key,
                      title: issue.title.slice(0, 200),
                      issue: issue.identifier,
                    });
                    navigate(`/whiteboards/${board.id}`);
                  })
                }
              >
                <Plus aria-hidden size={14} className="mr-1 inline" />
                {t('whiteboards.newOnIssue')}
              </button>
            )}
            {choices === undefined ? (
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => void run(async () => setChoices(await api.whiteboards()))}
              >
                {t('whiteboards.attachExisting')}
              </button>
            ) : (
              <select
                aria-label={t('whiteboards.attachExisting')}
                value=""
                className={quietSelectClass}
                onChange={(event) => {
                  const id = event.target.value;
                  if (!id) return;
                  void run(async () => {
                    setBoards(await api.attachWhiteboard(issue.identifier, id));
                    setChoices(undefined);
                  });
                }}
              >
                <option value="">{t('whiteboards.pick')}</option>
                {choices
                  .filter((b) => !attached.has(b.id))
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.team.key} · {b.title}
                    </option>
                  ))}
              </select>
            )}
          </div>
        )}
      </div>
      {boards?.map((board) => (
        <article
          key={board.id}
          aria-label={board.title}
          className="overflow-hidden rounded-xl border border-line bg-card shadow-card"
        >
          <header className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
            <span className="truncate font-medium text-ink">{board.title}</span>
            <span className="text-xs text-ink-faint">{board.team.key}</span>
            <Link
              href={`/whiteboards/${board.id}`}
              className="ml-auto flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <Maximize2 aria-hidden size={12} />
              {t('whiteboards.open')}
            </Link>
            {canAttach && (
              <button
                type="button"
                aria-label={t('whiteboards.detach', { title: board.title })}
                className="rounded-md p-1 text-ink-faint hover:bg-hover hover:text-ink"
                onClick={() =>
                  void run(async () => {
                    await api.detachWhiteboard(issue.identifier, board.id);
                    await reload();
                  })
                }
              >
                <X aria-hidden size={14} />
              </button>
            )}
          </header>
          <div className="h-80">
            <LazyCanvas
              board={{ ...board, issues: [] }}
              embedded
              onError={(failure) => onError(errorKey(failure))}
            />
          </div>
        </article>
      ))}
    </section>
  );
}
