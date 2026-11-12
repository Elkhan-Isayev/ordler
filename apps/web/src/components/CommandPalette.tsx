import type { IssueSummary, RequestSummary } from '@ordler/shared';
import { FileText, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { StatusIcon } from '../issues/ui.js';
import { RequestStatusBadge } from '../requests/common.js';
import { navigate } from '../router.js';

type Group = 'issues' | 'requests' | 'wiki';

interface Result {
  key: string;
  group: Group;
  href: string;
  /** Identifier of an issue or request; the space name of a wiki page. */
  label: string;
  title: string;
  issue?: IssueSummary;
  request?: RequestSummary;
}

const DEBOUNCE_MS = 200;
const GROUPS: readonly Group[] = ['issues', 'requests', 'wiki'];

/** Typing in a field must keep its own meaning of "/". */
function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

/**
 * Opens on Cmd/Ctrl+K, Cmd/Ctrl+F (replacing the browser's find, as in Linear), "/" outside
 * text fields, or the sidebar search field (SPEC §5.4).
 */
export function useCommandPalette(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && !event.altKey && (key === 'k' || key === 'f')) {
        event.preventDefault();
        setOpen((current) => (key === 'k' ? !current : true));
        return;
      }
      if (
        key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !typingInField(event.target)
      ) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return [open, setOpen];
}

/** Search by number (HELP-12, REQ-3 or just 12) or title; Enter opens the highlighted result. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>();
  const [active, setActive] = useState(0);
  const latest = useRef('');
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (!q) {
      setResults(undefined);
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
              group: 'issues' as const,
              href: `/issue/${issue.identifier}`,
              label: issue.identifier,
              title: issue.title,
              issue,
            })),
            ...found.requests.map((request) => ({
              key: request.id,
              group: 'requests' as const,
              href: `/requests/${request.identifier}`,
              label: request.identifier,
              title: request.title,
              request,
            })),
            ...(found.wikiPages ?? []).map((page) => ({
              key: page.id,
              group: 'wiki' as const,
              href: `/wiki/page/${page.id}`,
              label: page.department.name,
              title: page.title,
            })),
          ]);
          setActive(0);
        })
        .catch(() => setResults([]));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  function open(result: Result | undefined) {
    if (!result) return;
    onClose();
    navigate(result.href);
  }

  const shown = results ?? [];
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
        className="flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-card shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search aria-hidden size={16} className="shrink-0 text-ink-faint" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((i) => Math.min(i + 1, shown.length - 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              }
              if (event.key === 'Enter') open(shown[active]);
            }}
            placeholder={t('search.placeholder')}
            aria-label={t('search.title')}
            className="w-full bg-transparent py-3 text-sm text-ink outline-none"
          />
          <kbd className="rounded border border-line px-1.5 text-[10px] text-ink-faint">Esc</kbd>
        </div>
        <ul
          ref={list}
          role="listbox"
          aria-label={t('search.results')}
          className="max-h-96 overflow-y-auto py-1"
        >
          {!query.trim() && (
            <li className="px-4 py-3 text-sm text-ink-muted">{t('search.hint')}</li>
          )}
          {results?.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-muted">{t('search.empty')}</li>
          )}
          {GROUPS.map((group) => {
            const items = shown.filter((r) => r.group === group);
            if (items.length === 0) return null;
            return (
              <li key={group} role="presentation">
                <p className="px-4 pt-2 pb-1 text-xs font-medium text-ink-faint">
                  {t(`search.groups.${group}`)}
                </p>
                <ul role="group" aria-label={t(`search.groups.${group}`)}>
                  {items.map((result) => {
                    const index = shown.indexOf(result);
                    return (
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
                        {group === 'wiki' && (
                          <FileText aria-hidden size={14} className="shrink-0 text-ink-faint" />
                        )}
                        <span className="w-20 shrink-0 truncate text-ink-faint">
                          {result.label}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink">{result.title}</span>
                        {result.request && <RequestStatusBadge status={result.request.status} />}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
