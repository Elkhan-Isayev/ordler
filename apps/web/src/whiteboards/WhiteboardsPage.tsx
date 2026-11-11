import type { WhiteboardSummary } from '@ordler/shared';
import { Shapes } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, inputClass } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { selectClass } from '../issues/ui.js';
import { Link, navigate } from '../router.js';

type Team = Awaited<ReturnType<typeof api.readableTeams>>[number];

/** Whiteboards of every readable team (/whiteboards), with a form to start a new one. */
export function WhiteboardsPage() {
  const { t, i18n } = useTranslation();
  const [boards, setBoards] = useState<WhiteboardSummary[]>();
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      const [list, readable] = await Promise.all([api.whiteboards(), api.readableTeams()]);
      setBoards(list);
      setTeams(readable.filter((team) => team.whiteboards));
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(undefined);
    try {
      const board = await api.createWhiteboard({
        team: String(form.get('team')),
        title: String(form.get('title')),
      });
      navigate(`/whiteboards/${board.id}`);
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <h1 className="text-sm font-semibold text-ink">{t('nav.whiteboards')}</h1>
        {teams.length > 0 && (
          <form
            onSubmit={create}
            aria-label={t('whiteboards.new')}
            className="ml-auto flex flex-wrap items-center gap-2"
          >
            <input
              name="title"
              required
              maxLength={200}
              aria-label={t('whiteboards.titleLabel')}
              placeholder={t('whiteboards.titlePlaceholder')}
              className={inputClass}
            />
            <select name="team" aria-label={t('whiteboards.team')} className={selectClass}>
              {teams.map((team) => (
                <option key={team.id} value={team.key}>
                  {team.key} · {team.name}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonClass}>
              {t('whiteboards.create')}
            </button>
          </form>
        )}
      </header>
      {error && (
        <div className="p-4">
          <FormError message={error} />
        </div>
      )}
      {boards?.length === 0 && (
        <p className="p-8 text-center text-sm text-ink-muted">{t('whiteboards.empty')}</p>
      )}
      <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {boards?.map((board) => (
          <li key={board.id}>
            <Link
              href={`/whiteboards/${board.id}`}
              className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4 text-sm shadow-card hover:bg-hover"
            >
              <span className="flex items-center gap-2 font-medium text-ink">
                <Shapes aria-hidden size={16} className="shrink-0 text-ink-muted" />
                <span className="truncate">{board.title}</span>
              </span>
              <span className="text-xs text-ink-faint">
                {board.team.key}
                {board.createdBy ? ` · ${board.createdBy.name}` : ''}
                {' · '}
                {new Date(board.updatedAt).toLocaleDateString(i18n.language)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
