import type { IssueDetail, IssueSummary } from '@ordler/shared';
import { CircleHelp, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { inputClass } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { Link } from '../router.js';
import { StatusIcon } from './ui.js';

type Side = 'blockedBy' | 'blocking';
const SIDES: Side[] = ['blockedBy', 'blocking'];

/**
 * "Blocked by" and "Blocking" (SPEC §5.1 relations), as in Linear: adding one on this issue
 * shows the reverse on the other. Readers without edit rights only see the lists.
 */
export function IssueBlocks({
  issue,
  editable,
  onChanged,
  onError,
}: {
  issue: IssueDetail;
  editable: boolean;
  onChanged: () => void;
  onError: (code: string) => void;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const empty = issue.blockedBy.length === 0 && issue.blocking.length === 0;
  if (empty && !editable) return null;

  async function save(side: Side, list: IssueSummary[]) {
    try {
      await api.updateIssue(issue.identifier, { [side]: list.map((i) => i.identifier) });
      onChanged();
    } catch (failure) {
      onError(errorKey(failure));
    }
  }

  return (
    <section aria-label={t('issues.blocks.title')} className="flex flex-col gap-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        {t('issues.blocks.title')}
        <Link
          href="/help#issue-blocking"
          title={t('issues.blocks.help')}
          aria-label={t('issues.blocks.help')}
          className="text-ink-faint hover:text-ink"
        >
          <CircleHelp aria-hidden size={13} />
        </Link>
      </h2>
      {SIDES.map((side) =>
        issue[side].length === 0 ? null : (
          <div key={side} className="flex flex-col gap-0.5">
            <h3 className="text-xs text-ink-faint">{t(`issues.blocks.${side}`)}</h3>
            <ul aria-label={t(`issues.blocks.${side}`)} className="flex flex-col">
              {issue[side].map((other) => (
                <li key={other.id} className="group flex items-center gap-1">
                  <Link
                    href={`/issue/${other.identifier}`}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-hover"
                  >
                    <StatusIcon category={other.status.category} />
                    <span className="w-20 shrink-0 text-ink-faint">{other.identifier}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{other.title}</span>
                  </Link>
                  {editable && (
                    <button
                      type="button"
                      aria-label={t('issues.blocks.remove', { identifier: other.identifier })}
                      className="rounded p-1 text-ink-faint hover:bg-hover hover:text-ink"
                      onClick={() =>
                        void save(
                          side,
                          issue[side].filter((i) => i.id !== other.id),
                        )
                      }
                    >
                      <X aria-hidden size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
      {editable &&
        (adding ? (
          <AddBlock
            issue={issue}
            onCancel={() => setAdding(false)}
            onPick={async (side, other) => {
              setAdding(false);
              await save(side, [...issue[side], other]);
            }}
          />
        ) : (
          <button
            type="button"
            className="flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-ink-muted hover:bg-hover hover:text-ink"
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden size={14} />
            {t('issues.blocks.add')}
          </button>
        ))}
    </section>
  );
}

/** Picks the side, then an issue found by identifier or title. */
function AddBlock({
  issue,
  onPick,
  onCancel,
}: {
  issue: IssueDetail;
  onPick: (side: Side, other: IssueSummary) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [side, setSide] = useState<Side>('blockedBy');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<IssueSummary[]>();

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setFound(undefined);
      return;
    }
    let current = true;
    // A short pause so typing an identifier does not search every letter.
    const timer = setTimeout(() => {
      api
        .search(q)
        .then((results) => current && setFound(results.issues))
        .catch(() => current && setFound([]));
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  const taken = new Set([issue.id, ...SIDES.flatMap((s) => issue[s].map((i) => i.id))]);
  const options = (found ?? []).filter((i) => !taken.has(i.id)).slice(0, 8);

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line p-2">
      <div className="flex gap-1.5">
        <select
          value={side}
          aria-label={t('issues.blocks.type')}
          className={`${inputClass} py-1 text-xs`}
          onChange={(event) => setSide(event.target.value as Side)}
        >
          {SIDES.map((s) => (
            <option key={s} value={s}>
              {t(`issues.blocks.${s}`)}
            </option>
          ))}
        </select>
        <input
          autoFocus
          value={query}
          aria-label={t('issues.blocks.search')}
          placeholder={t('issues.blocks.search')}
          className={`${inputClass} min-w-0 flex-1 py-1 text-xs`}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel();
          }}
        />
        <button
          type="button"
          aria-label={t('issues.blocks.cancel')}
          className="rounded p-1 text-ink-faint hover:bg-hover hover:text-ink"
          onClick={onCancel}
        >
          <X aria-hidden size={14} />
        </button>
      </div>
      {found && (
        <ul role="listbox" aria-label={t('issues.blocks.results')} className="flex flex-col">
          {options.length === 0 && (
            <li className="px-2 py-1 text-xs text-ink-faint">{t('issues.blocks.noResults')}</li>
          )}
          {options.map((other) => (
            <li key={other.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-hover"
                onClick={() => void onPick(side, other)}
              >
                <StatusIcon category={other.status.category} />
                <span className="w-20 shrink-0 text-ink-faint">{other.identifier}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{other.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
