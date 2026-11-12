import type { WhiteboardSummary } from '@ordler/shared';
import { Shapes } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, ghostButtonClass, inputClass } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { selectClass } from '../issues/ui.js';

type Team = Awaited<ReturnType<typeof api.readableTeams>>[number];

/**
 * Adds a diagram to a wiki page: an existing whiteboard or a new one drawn with the
 * whiteboard editor (SPEC §5.5). The page embeds it as a live board.
 */
export function InsertWhiteboard({
  onInsert,
  onError,
}: {
  onInsert: (board: { id: string; title: string }) => void;
  onError: (code: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [boards, setBoards] = useState<WhiteboardSummary[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  async function show() {
    try {
      const [list, readable] = await Promise.all([api.whiteboards(), api.readableTeams()]);
      setBoards(list);
      setTeams(readable.filter((team) => team.whiteboards));
      setOpen(true);
    } catch (failure) {
      onError(errorKey(failure));
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const board = await api.createWhiteboard({
        team: String(form.get('team')),
        title: String(form.get('title')),
      });
      onInsert(board);
      setOpen(false);
    } catch (failure) {
      onError(errorKey(failure));
    }
  }

  if (!open) {
    return (
      <button type="button" className={ghostButtonClass} onClick={() => void show()}>
        <Shapes aria-hidden size={14} className="mr-1 inline" />
        {t('wiki.insertBoard')}
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={t('wiki.insertBoard')}
      className="flex w-full flex-col gap-2 rounded-lg border border-line bg-card p-3"
    >
      {boards.length > 0 && (
        <select
          aria-label={t('wiki.existingBoard')}
          defaultValue=""
          className={selectClass}
          onChange={(event) => {
            const board = boards.find((b) => b.id === event.target.value);
            if (board) {
              onInsert(board);
              setOpen(false);
            }
          }}
        >
          <option value="" disabled>
            {t('wiki.existingBoard')}
          </option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.team.key} · {b.title}
            </option>
          ))}
        </select>
      )}
      {teams.length > 0 && (
        <form
          onSubmit={(event) => void create(event)}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            name="title"
            required
            maxLength={200}
            aria-label={t('wiki.newBoardTitle')}
            placeholder={t('wiki.newBoardTitle')}
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
            {t('wiki.createBoard')}
          </button>
        </form>
      )}
      <div>
        <button type="button" className={ghostButtonClass} onClick={() => setOpen(false)}>
          {t('wiki.cancel')}
        </button>
      </div>
    </div>
  );
}
