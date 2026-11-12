import {
  wikiWhiteboardEmbed,
  type WikiPageView,
  type WikiRevision,
  type WikiRevisionView,
  type WikiTree,
} from '@ordler/shared';
import { History, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, ghostButtonClass, inputClass } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { RichEditor } from '../editor/RichEditor.js';
import { selectClass } from '../issues/ui.js';
import { Link, navigate } from '../router.js';
import { InsertWhiteboard } from './InsertWhiteboard.js';
import { folderPaths } from './tree.js';
import { WikiContent } from './WikiContent.js';
import { WikiTreeNav } from './WikiTreeNav.js';

/** /wiki/page/:id (and /edit): read, edit with conflict protection, browse history. */
export function WikiPageScreen({ id, edit = false }: { id: string; edit?: boolean }) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState<WikiPageView>();
  const [tree, setTree] = useState<WikiTree>();
  const [editing, setEditing] = useState(edit);
  const [history, setHistory] = useState<WikiRevision[]>();
  const [revision, setRevision] = useState<WikiRevisionView>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      const view = await api.wikiPage(id);
      setPage(view);
      setTree(await api.wikiTree(view.department.id));
    } catch (failure) {
      setError(errorKey(failure));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(errorKey(failure));
    }
  }

  if (!page) {
    return error ? (
      <div className="p-4">
        <FormError message={t(error)} />
      </div>
    ) : null;
  }

  const shown = revision ?? page;

  return (
    <div className="flex min-h-0 flex-1">
      {tree && <WikiTreeNav key={page.id} tree={tree} currentPageId={page.id} />}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <nav aria-label={t('wiki.breadcrumbs')} className="flex items-center gap-1 text-sm">
            <Link href="/wiki" className="text-ink-muted hover:underline">
              {t('nav.wiki')}
            </Link>
            <span className="text-ink-faint">/</span>
            <Link href={`/wiki/${page.department.id}`} className="text-ink-muted hover:underline">
              {page.department.name}
            </Link>
            {page.path.map((folder) => (
              <span key={folder.id} className="flex items-center gap-1 text-ink-muted">
                <span className="text-ink-faint">/</span>
                {folder.name}
              </span>
            ))}
          </nav>
          {!editing && (
            <div className="ml-auto flex items-center gap-2">
              {page.canEdit && (
                <button type="button" className={buttonClass} onClick={() => setEditing(true)}>
                  <Pencil aria-hidden size={14} className="mr-1 inline" />
                  {t('wiki.edit')}
                </button>
              )}
              <button
                type="button"
                className={ghostButtonClass}
                aria-pressed={history !== undefined}
                onClick={() =>
                  history
                    ? (setHistory(undefined), setRevision(undefined))
                    : void run(async () => setHistory(await api.wikiRevisions(page.id)))
                }
              >
                <History aria-hidden size={14} className="mr-1 inline" />
                {t('wiki.history')}
              </button>
              {page.canManage && (
                <button
                  type="button"
                  aria-label={t('wiki.deletePage')}
                  className={ghostButtonClass}
                  onClick={() => {
                    if (!window.confirm(t('wiki.confirmDelete', { title: page.title }))) return;
                    void run(async () => {
                      await api.deleteWikiPage(page.id);
                      navigate(`/wiki/${page.department.id}`);
                    });
                  }}
                >
                  <Trash2 aria-hidden size={14} />
                </button>
              )}
            </div>
          )}
        </header>
        <div className="flex gap-6 p-6">
          <article className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4">
            {error && <FormError message={t(error)} />}
            {editing && tree ? (
              <PageEditor
                page={page}
                tree={tree}
                onSaved={(next) => {
                  setPage(next);
                  setEditing(false);
                  setHistory(undefined);
                  if (edit) window.history.replaceState(null, '', `/wiki/page/${next.id}`);
                  void load();
                }}
                onCancel={() => {
                  setEditing(false);
                  if (edit) window.history.replaceState(null, '', `/wiki/page/${page.id}`);
                }}
              />
            ) : (
              <>
                <h1 className="text-2xl font-semibold text-ink">{shown.title}</h1>
                <p className="text-xs text-ink-faint">
                  {revision
                    ? t('wiki.viewingVersion', {
                        version: revision.version,
                        name: revision.author?.name ?? '—',
                        date: new Date(revision.createdAt).toLocaleString(i18n.language),
                      })
                    : t('wiki.updated', {
                        name: page.updatedBy?.name ?? '—',
                        date: new Date(page.updatedAt).toLocaleString(i18n.language),
                        version: page.version,
                      })}
                </p>
                {revision && page.canEdit && revision.version !== page.version && (
                  <div>
                    <button
                      type="button"
                      className={ghostButtonClass}
                      onClick={() =>
                        void run(async () => {
                          await api.updateWikiPage(page.id, {
                            title: revision.title,
                            content: revision.content,
                            baseVersion: page.version,
                          });
                          setRevision(undefined);
                          setHistory(await api.wikiRevisions(page.id));
                          await load();
                        })
                      }
                    >
                      {t('wiki.restore')}
                    </button>
                  </div>
                )}
                <WikiContent
                  key={`${shown.title}:${revision?.version ?? page.version}`}
                  content={shown.content}
                  label={t('wiki.content')}
                />
              </>
            )}
          </article>
          {history && !editing && (
            <aside
              aria-label={t('wiki.history')}
              className="w-60 shrink-0 border-l border-line pl-4"
            >
              <ul className="flex flex-col gap-1">
                {history.map((r) => (
                  <li key={r.version}>
                    <button
                      type="button"
                      aria-current={(revision?.version ?? page.version) === r.version}
                      onClick={() =>
                        void run(async () =>
                          setRevision(
                            r.version === page.version
                              ? undefined
                              : await api.wikiRevision(page.id, r.version),
                          ),
                        )
                      }
                      className={`flex w-full flex-col rounded-md px-2 py-1.5 text-left text-xs hover:bg-hover ${
                        (revision?.version ?? page.version) === r.version ? 'bg-hover' : ''
                      }`}
                    >
                      <span className="font-medium text-ink">
                        {t('wiki.version', { version: r.version })}
                      </span>
                      <span className="text-ink-faint">
                        {r.author?.name ?? '—'} ·{' '}
                        {new Date(r.createdAt).toLocaleString(i18n.language)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

/** Title, folder and text, saved together; a newer version saved meanwhile is a conflict. */
function PageEditor({
  page,
  tree,
  onSaved,
  onCancel,
}: {
  page: WikiPageView;
  tree: WikiTree;
  onSaved: (page: WikiPageView) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(page.title);
  const [folderId, setFolderId] = useState(page.folderId);
  const [content, setContent] = useState(page.content);
  // The editor reads its value once; inserting a board remounts it with the new text.
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const paths = folderPaths(tree.folders);

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      onSaved(
        await api.updateWikiPage(page.id, {
          title,
          content,
          ...(folderId !== page.folderId ? { folderId } : {}),
          baseVersion: page.version,
        }),
      );
    } catch (failure) {
      setError(errorKey(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={200}
        aria-label={t('wiki.pageTitle')}
        className={`${inputClass} text-lg font-semibold`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t('wiki.folder')}
          value={folderId ?? ''}
          onChange={(event) => setFolderId(event.target.value || null)}
          className={selectClass}
        >
          <option value="">{t('wiki.rootFolder')}</option>
          {[...paths.entries()]
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([id, path]) => (
              <option key={id} value={id}>
                {path}
              </option>
            ))}
        </select>
        <InsertWhiteboard
          onInsert={(board) => {
            setContent(
              (text) => `${text.trimEnd()}\n\n${wikiWhiteboardEmbed(board.id, board.title)}\n`,
            );
            setRevision((n) => n + 1);
          }}
          onError={setError}
        />
      </div>
      <p className="text-xs text-ink-faint">{t('wiki.embedHint')}</p>
      <RichEditor
        key={revision}
        value={content}
        label={t('wiki.content')}
        placeholder={t('wiki.contentPlaceholder')}
        onChange={setContent}
        onUpload={(file) => api.uploadWikiFile(page.department.id, file)}
        onUploadError={(failure) => setError(errorKey(failure))}
        className="min-h-80"
      />
      {error && <FormError message={t(error)} />}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={busy || !title.trim()}
          onClick={() => void save()}
        >
          {t('wiki.save')}
        </button>
        <button type="button" className={ghostButtonClass} onClick={onCancel}>
          {t('wiki.cancel')}
        </button>
      </div>
    </div>
  );
}
