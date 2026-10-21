import type { IssueSummary, RequestSummary } from '@ordler/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { StatusIcon } from '../issues/ui.js';
import { RequestStatusBadge } from '../requests/common.js';
import { navigate } from '../router.js';

interface Result {
  key: string;
  href: string;
  identifier: string;
  title: string;
  issue?: IssueSummary;
  request?: RequestSummary;
}

const DEBOUNCE_MS = 200;

/** Opens on Cmd/Ctrl+K or the sidebar search button (SPEC §5.4). */
export function useCommandPalette(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return [open, setOpen];
}

/** Search issues and requests the member can open; Enter opens the highlighted result. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const latest = useRef('');

  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (!q) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .search(q)
        .then((found) => {
          // Ignore answers to queries the user has already typed past.
          if (latest.current !== q) return;
          setResults([
            ...found.issues.map((issue) => ({
              key: issue.id,
              href: `/issue/${issue.identifier}`,
              identifier: issue.identifier,
              title: issue.title,
              issue,
            })),
            ...found.requests.map((request) => ({
              key: request.id,
              href: `/requests/${request.identifier}`,
              identifier: request.identifier,
              title: request.title,
              request,
            })),
          ]);
          setActive(0);
        })
        .catch(() => setResults([]));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  function open(result: Result | undefined) {
    if (!result) return;
    onClose();
    navigate(result.href);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[15vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('search.title')}
        className="flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (event.key === 'Enter') open(results[active]);
          }}
          placeholder={t('search.placeholder')}
          aria-label={t('search.title')}
          className="border-b border-line bg-transparent px-4 py-3 text-sm text-ink outline-none"
        />
        <ul role="listbox" aria-label={t('search.results')} className="max-h-80 overflow-y-auto">
          {query.trim() && results.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-muted">{t('search.empty')}</li>
          )}
          {results.map((result, index) => (
            <li
              key={result.key}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => open(result)}
              className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm ${
                index === active ? 'bg-hover' : ''
              }`}
            >
              {result.issue && <StatusIcon category={result.issue.status.category} />}
              <span className="w-20 shrink-0 text-ink-faint">{result.identifier}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{result.title}</span>
              {result.request && <RequestStatusBadge status={result.request.status} />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
