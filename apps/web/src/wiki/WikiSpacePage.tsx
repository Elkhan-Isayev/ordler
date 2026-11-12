import type { WikiTree } from '@ordler/shared';
import { FileText, Folder, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, ghostButtonClass, inputClass } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { selectClass } from '../issues/ui.js';
import { Link, navigate } from '../router.js';
import { ancestry, contentsOf } from './tree.js';
import { WikiImport } from './WikiImport.js';
import { WikiTreeNav } from './WikiTreeNav.js';

type Form = 'page' | 'folder' | 'rename' | 'import' | undefined;

/** /wiki/:departmentId: one department's space, browsed folder by folder (SPEC §5.6). */
export function WikiSpacePage({ departmentId }: { departmentId: string }) {
  const { t, i18n } = useTranslation();
  const [tree, setTree] = useState<WikiTree>();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setTree(await api.wikiTree(departmentId));
    } catch (failure) {
      setError(errorKey(failure));
    }
  }, [departmentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(action: () => Promise<unknown>) {
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(errorKey(failure));
    }
  }

  if (!tree) {
    return error ? (
      <div className="p-4">
        <FormError message={t(error)} />
      </div>
    ) : null;
  }

  const { space } = tree;
  const here = contentsOf(folderId, tree.folders, tree.pages);
  const path = ancestry(folderId, tree.folders);
  const folder = path.at(-1);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    if (!name) return;
    void run(async () => {
      if (form === 'page') {
        const page = await api.createWikiPage({ department: departmentId, folderId, title: name });
        navigate(`/wiki/page/${page.id}/edit`);
        return;
      }
      if (form === 'folder') {
        const created = await api.createWikiFolder({
          department: departmentId,
          parentId: folderId,
          name,
        });
        setFolderId(created.id);
      } else if (form === 'rename' && folder) {
        await api.updateWikiFolder(folder.id, { name });
      }
      setForm(undefined);
      await reload();
    });
  }

  return (
    <div className="flex min-h-0 flex-1">
      <WikiTreeNav tree={tree} currentFolderId={folderId} onFolder={setFolderId} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <nav aria-label={t('wiki.breadcrumbs')} className="flex items-center gap-1 text-sm">
            <Link href="/wiki" className="text-ink-muted hover:underline">
              {t('nav.wiki')}
            </Link>
            <span className="text-ink-faint">/</span>
            <button
              type="button"
              onClick={() => setFolderId(null)}
              className="font-semibold text-ink hover:underline"
            >
              {space.department.name}
            </button>
            {path.map((f) => (
              <span key={f.id} className="flex items-center gap-1">
                <span className="text-ink-faint">/</span>
                <button
                  type="button"
                  onClick={() => setFolderId(f.id)}
                  className="text-ink hover:underline"
                >
                  {f.name}
                </button>
              </span>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {space.canEdit && (
              <>
                <button type="button" className={buttonClass} onClick={() => setForm('page')}>
                  <Plus aria-hidden size={14} className="mr-1 inline" />
                  {t('wiki.newPage')}
                </button>
                <button
                  type="button"
                  className={ghostButtonClass}
                  onClick={() => setForm('folder')}
                >
                  <FolderPlus aria-hidden size={14} className="mr-1 inline" />
                  {t('wiki.newFolder')}
                </button>
              </>
            )}
            {space.canEdit && folder && (
              <>
                <button
                  type="button"
                  aria-label={t('wiki.renameFolder', { name: folder.name })}
                  className={ghostButtonClass}
                  onClick={() => setForm('rename')}
                >
                  <Pencil aria-hidden size={14} />
                </button>
                <button
                  type="button"
                  aria-label={t('wiki.deleteFolder', { name: folder.name })}
                  className={ghostButtonClass}
                  onClick={() =>
                    void run(async () => {
                      await api.deleteWikiFolder(folder.id);
                      setFolderId(folder.parentId);
                      await reload();
                    })
                  }
                >
                  <Trash2 aria-hidden size={14} />
                </button>
              </>
            )}
            {space.canManage && (
              <>
                <select
                  aria-label={t('wiki.visibilityLabel')}
                  value={space.visibility}
                  className={selectClass}
                  onChange={(event) =>
                    void run(async () => {
                      await api.setWikiVisibility(
                        departmentId,
                        event.target.value as typeof space.visibility,
                      );
                      await reload();
                    })
                  }
                >
                  <option value="department">{t('wiki.visibility.department')}</option>
                  <option value="organization">{t('wiki.visibility.organization')}</option>
                </select>
                <button
                  type="button"
                  className={ghostButtonClass}
                  onClick={() => setForm('import')}
                >
                  {t('wiki.import.open')}
                </button>
              </>
            )}
          </div>
        </header>
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          {error && <FormError message={t(error)} />}
          {(form === 'page' || form === 'folder' || form === 'rename') && (
            <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
              <input
                name="name"
                required
                autoFocus
                maxLength={200}
                defaultValue={form === 'rename' ? folder?.name : ''}
                aria-label={t(form === 'page' ? 'wiki.pageTitle' : 'wiki.folderName')}
                placeholder={t(form === 'page' ? 'wiki.pageTitle' : 'wiki.folderName')}
                className={`${inputClass} w-72`}
              />
              <button type="submit" className={buttonClass}>
                {t(form === 'rename' ? 'wiki.save' : 'wiki.create')}
              </button>
              <button type="button" className={ghostButtonClass} onClick={() => setForm(undefined)}>
                {t('wiki.cancel')}
              </button>
            </form>
          )}
          {form === 'import' && (
            <WikiImport
              departmentId={departmentId}
              folderId={folderId}
              onClose={() => {
                setForm(undefined);
                void reload();
              }}
            />
          )}
          {here.folders.length === 0 && here.pages.length === 0 && (
            <p className="py-8 text-center text-sm text-ink-muted">
              {t(folderId ? 'wiki.emptyFolder' : 'wiki.emptySpace')}
            </p>
          )}
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-card empty:hidden">
            {here.folders.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => setFolderId(f.id)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-hover"
                >
                  <Folder aria-hidden size={16} className="text-ink-muted" />
                  <span className="font-medium text-ink">{f.name}</span>
                </button>
              </li>
            ))}
            {here.pages.map((page) => (
              <li key={page.id}>
                <Link
                  href={`/wiki/page/${page.id}`}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-hover"
                >
                  <FileText aria-hidden size={16} className="text-ink-muted" />
                  <span className="text-ink">{page.title}</span>
                  <span className="ml-auto text-xs text-ink-faint">
                    {page.updatedBy ? `${page.updatedBy.name} · ` : ''}
                    {new Date(page.updatedAt).toLocaleDateString(i18n.language)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
