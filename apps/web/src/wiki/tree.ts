import type { WikiFolder, WikiImportSourcePage, WikiPageSummary } from '@ordler/shared';

/** Folder id → readable path like "Guides / Network", for pickers. */
export function folderPaths(folders: readonly WikiFolder[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const paths = new Map<string, string>();
  for (const folder of folders) {
    const names: string[] = [];
    let current: WikiFolder | undefined = folder;
    while (current && names.length < 32) {
      names.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    paths.set(folder.id, names.join(' / '));
  }
  return paths;
}

export function byName<T extends { name?: string; title?: string }>(a: T, b: T): number {
  return (a.name ?? a.title ?? '').localeCompare(b.name ?? b.title ?? '', undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}

/** What a folder (or the root, `null`) directly contains. */
export function contentsOf(
  folderId: string | null,
  folders: readonly WikiFolder[],
  pages: readonly WikiPageSummary[],
): { folders: WikiFolder[]; pages: WikiPageSummary[] } {
  return {
    folders: folders.filter((f) => f.parentId === folderId).sort(byName),
    pages: pages.filter((p) => p.folderId === folderId).sort(byName),
  };
}

/** Folders from the root down to `folderId`, for breadcrumbs and keeping the tree open. */
export function ancestry(folderId: string | null, folders: readonly WikiFolder[]): WikiFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: WikiFolder[] = [];
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && chain.length < 32) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/** One row of the Wiki.js picker: a folder path or a page, indented by depth. */
export type ImportRow =
  | { kind: 'folder'; path: string; depth: number; name: string }
  | { kind: 'page'; page: WikiImportSourcePage; depth: number; name: string };

/** Folders and pages of a Wiki.js site in tree order, each folder right before its contents. */
export function importRows(pages: readonly WikiImportSourcePage[]): ImportRow[] {
  const folders = new Set<string>();
  for (const page of pages) {
    const parts = page.path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  const rows: ImportRow[] = [
    ...[...folders].map((path) => ({
      kind: 'folder' as const,
      path,
      depth: path.split('/').length - 1,
      name: path.split('/').pop()!,
    })),
    ...pages.map((page) => ({
      kind: 'page' as const,
      page,
      depth: page.path.split('/').filter(Boolean).length - 1,
      name: page.title,
    })),
  ];
  // A folder sorts as its path plus "/", so it comes before the pages inside it.
  const sortKey = (row: ImportRow) => (row.kind === 'folder' ? `${row.path}/` : row.page.path);
  return rows.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}
