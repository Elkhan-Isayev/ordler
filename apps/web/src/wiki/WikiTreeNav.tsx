import type { WikiTree } from '@ordler/shared';
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '../router.js';
import { ancestry, contentsOf } from './tree.js';

/**
 * The tree of one department's space beside every wiki screen. Folders open on click; the
 * folders around the current page or folder start open.
 */
export function WikiTreeNav({
  tree,
  currentPageId,
  currentFolderId,
  onFolder,
}: {
  tree: WikiTree;
  currentPageId?: string | undefined;
  currentFolderId?: string | null | undefined;
  onFolder?: ((folderId: string | null) => void) | undefined;
}) {
  const { t } = useTranslation();
  const currentPage = tree.pages.find((p) => p.id === currentPageId);
  const [open, setOpen] = useState<Set<string>>(
    () =>
      new Set(
        ancestry(currentPage?.folderId ?? currentFolderId ?? null, tree.folders).map((f) => f.id),
      ),
  );

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function level(folderId: string | null, depth: number) {
    const { folders, pages } = contentsOf(folderId, tree.folders, tree.pages);
    return (
      <ul className="flex flex-col">
        {folders.map((folder) => {
          const expanded = open.has(folder.id);
          return (
            <li key={folder.id}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => {
                  toggle(folder.id);
                  onFolder?.(folder.id);
                }}
                className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm hover:bg-hover ${
                  currentFolderId === folder.id ? 'bg-hover text-ink' : 'text-ink-muted'
                }`}
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
              >
                {expanded ? (
                  <ChevronDown aria-hidden size={14} className="shrink-0" />
                ) : (
                  <ChevronRight aria-hidden size={14} className="shrink-0" />
                )}
                <Folder aria-hidden size={14} className="shrink-0" />
                <span className="truncate">{folder.name}</span>
              </button>
              {expanded && level(folder.id, depth + 1)}
            </li>
          );
        })}
        {pages.map((page) => (
          <li key={page.id}>
            <Link
              href={`/wiki/page/${page.id}`}
              aria-current={page.id === currentPageId ? 'page' : undefined}
              className={`flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm hover:bg-hover ${
                page.id === currentPageId ? 'bg-hover font-medium text-ink' : 'text-ink-muted'
              }`}
              style={{ paddingLeft: `${depth * 12 + 22}px` }}
            >
              <FileText aria-hidden size={14} className="shrink-0" />
              <span className="truncate">{page.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <nav
      aria-label={t('wiki.tree', { name: tree.space.department.name })}
      className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto border-r border-line p-3"
    >
      <Link
        href={`/wiki/${tree.space.department.id}`}
        onClick={() => onFolder?.(null)}
        className="truncate px-1 text-sm font-semibold text-ink hover:underline"
      >
        {tree.space.department.name}
      </Link>
      {tree.folders.length === 0 && tree.pages.length === 0 ? (
        <p className="px-1 text-xs text-ink-faint">{t('wiki.emptySpace')}</p>
      ) : (
        level(null, 0)
      )}
    </nav>
  );
}
