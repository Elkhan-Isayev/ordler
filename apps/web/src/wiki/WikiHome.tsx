import type { WikiSearchHit, WikiSpace } from '@ordler/shared';
import { BookOpen, Globe, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { inputClass } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { Link } from '../router.js';

const SEARCH_DELAY_MS = 250;

/** /wiki: the spaces of every readable department and a search across them (SPEC §5.6). */
export function WikiHome() {
  const { t } = useTranslation();
  const [spaces, setSpaces] = useState<WikiSpace[]>();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<WikiSearchHit[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .wikiSpaces()
      .then(setSpaces)
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, []);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setHits(undefined);
      return;
    }
    const timer = setTimeout(() => {
      api
        .searchWiki(text)
        .then(setHits)
        .catch((failure: unknown) => setError(errorKey(failure)));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <h1 className="text-sm font-semibold text-ink">{t('nav.wiki')}</h1>
        <label className="relative ml-auto">
          <Search
            aria-hidden
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t('wiki.search')}
            placeholder={t('wiki.search')}
            className={`${inputClass} w-64 pl-8`}
          />
        </label>
      </header>
      {error && (
        <div className="p-4">
          <FormError message={t(error)} />
        </div>
      )}
      {hits ? (
        <section aria-label={t('wiki.results')} className="flex flex-col gap-2 p-4">
          {hits.length === 0 && <p className="text-sm text-ink-muted">{t('wiki.noResults')}</p>}
          {hits.map((hit) => (
            <Link
              key={hit.id}
              href={`/wiki/page/${hit.id}`}
              className="flex flex-col gap-1 rounded-lg border border-line bg-card p-3 text-sm hover:bg-hover"
            >
              <span className="font-medium text-ink">{hit.title}</span>
              <span className="text-xs text-ink-faint">{hit.department.name}</span>
              <span className="text-ink-muted">{hit.snippet}</span>
            </Link>
          ))}
        </section>
      ) : (
        <>
          {spaces?.length === 0 && (
            <p className="p-8 text-center text-sm text-ink-muted">{t('wiki.noSpaces')}</p>
          )}
          <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {spaces?.map((space) => (
              <li key={space.department.id}>
                <Link
                  href={`/wiki/${space.department.id}`}
                  className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4 text-sm shadow-card hover:bg-hover"
                >
                  <span className="flex items-center gap-2 font-medium text-ink">
                    <BookOpen aria-hidden size={16} className="shrink-0 text-ink-muted" />
                    <span className="truncate">{space.department.name}</span>
                    {space.visibility === 'organization' && (
                      <Globe
                        aria-label={t('wiki.visibility.organization')}
                        size={14}
                        className="text-ink-faint"
                      />
                    )}
                  </span>
                  <span className="text-xs text-ink-faint">
                    {t('wiki.pageCount', { count: space.pages })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
