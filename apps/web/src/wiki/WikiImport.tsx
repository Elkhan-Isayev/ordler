import { type WikiImportSourcePage, type WikiImportView } from '@ordler/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, ghostButtonClass, inputClass, Panel } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { importRows } from './tree.js';

const POLL_MS = 2000;

/**
 * Import from Wiki.js (ADR 0017): connect with an API key, tick folders and pages, then watch
 * the background import. It lands in the folder that was open.
 */
export function WikiImport({
  departmentId,
  folderId,
  onClose,
}: {
  departmentId: string;
  folderId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [run, setRun] = useState<WikiImportView>();
  const [pages, setPages] = useState<WikiImportSourcePage[]>();
  const [paths, setPaths] = useState<Set<string>>(new Set());
  const [pageIds, setPageIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (run?.status !== 'running') return;
    const timer = setInterval(() => {
      void api
        .wikiImport(run.id)
        .then(setRun)
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [run?.id, run?.status]);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(errorKey(failure));
    } finally {
      setBusy(false);
    }
  }

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void act(async () => {
      const connected = await api.connectWikiImport({
        department: departmentId,
        folderId,
        baseUrl: String(form.get('baseUrl') ?? '').trim(),
        token: String(form.get('token') ?? '').trim(),
      });
      setRun(connected);
      setPages(await api.wikiImportPages(connected.id));
    });
  }

  function toggle<T>(set: Set<T>, value: T, update: (next: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  }

  const covered = (path: string) =>
    [...paths].some((folder) => path !== folder && path.startsWith(`${folder}/`));

  return (
    <Panel>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">{t('wiki.import.title')}</h2>
        {!run && (
          <form onSubmit={connect} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              {t('wiki.import.baseUrl')}
              <input
                name="baseUrl"
                type="url"
                required
                placeholder="https://wiki.company.com"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              {t('wiki.import.token')}
              <input
                name="token"
                type="password"
                required
                minLength={20}
                autoComplete="off"
                aria-describedby="wiki-import-token-hint"
                className={inputClass}
              />
            </label>
            <p id="wiki-import-token-hint" className="-mt-2 text-xs text-ink-faint">
              {t('wiki.import.tokenHint')}
            </p>
            <div className="flex gap-2">
              <button type="submit" className={buttonClass} disabled={busy}>
                {busy ? t('imports.connecting') : t('imports.connectButton')}
              </button>
              <button type="button" className={ghostButtonClass} onClick={onClose}>
                {t('wiki.cancel')}
              </button>
            </div>
          </form>
        )}
        {run?.status === 'draft' && pages && (
          <>
            <p className="text-xs text-ink-muted">{t('wiki.import.choose')}</p>
            <ul
              aria-label={t('wiki.import.pages')}
              className="flex max-h-80 flex-col overflow-y-auto rounded-md border border-line p-2"
            >
              {importRows(pages).map((row) => {
                const key = row.kind === 'folder' ? `f:${row.path}` : `p:${row.page.id}`;
                const inherited = covered(row.kind === 'folder' ? row.path : row.page.path);
                const checked =
                  inherited ||
                  (row.kind === 'folder' ? paths.has(row.path) : pageIds.has(row.page.id));
                return (
                  <li key={key} style={{ paddingLeft: `${row.depth * 16}px` }}>
                    <label className="flex items-center gap-2 py-0.5 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={inherited}
                        onChange={() =>
                          row.kind === 'folder'
                            ? toggle(paths, row.path, setPaths)
                            : toggle(pageIds, row.page.id, setPageIds)
                        }
                      />
                      {row.kind === 'folder' ? (
                        <span className="font-medium">
                          {t('wiki.import.folder', { name: row.name })}
                        </span>
                      ) : (
                        <span>
                          {row.name}{' '}
                          <span className="text-xs text-ink-faint">/{row.page.path}</span>
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                className={buttonClass}
                disabled={busy || (paths.size === 0 && pageIds.size === 0)}
                onClick={() =>
                  void act(async () =>
                    setRun(
                      await api.startWikiImport(run.id, {
                        paths: [...paths],
                        pageIds: [...pageIds],
                      }),
                    ),
                  )
                }
              >
                {t('wiki.import.start')}
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() =>
                  void act(async () => {
                    await api.cancelWikiImport(run.id);
                    onClose();
                  })
                }
              >
                {t('wiki.cancel')}
              </button>
            </div>
          </>
        )}
        {run && run.status !== 'draft' && (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-ink">
              {t(`wiki.import.status.${run.status}`)} ·{' '}
              {t('wiki.import.counts', { ...run.counts, total: run.total })}
            </p>
            {run.error && <FormError message={t('wiki.import.failed', { error: run.error })} />}
            {run.report.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-ink-muted">
                {run.report.map((item) => (
                  <li key={item.path}>
                    /{item.path}: {item.reason}
                  </li>
                ))}
              </ul>
            )}
            <div>
              {run.status === 'running' ? (
                <button
                  type="button"
                  className={ghostButtonClass}
                  onClick={() => void act(async () => setRun(await api.cancelWikiImport(run.id)))}
                >
                  {t('imports.cancel')}
                </button>
              ) : (
                <button type="button" className={buttonClass} onClick={onClose}>
                  {t('imports.close')}
                </button>
              )}
            </div>
          </div>
        )}
        {error && <FormError message={t(error)} />}
      </div>
    </Panel>
  );
}
