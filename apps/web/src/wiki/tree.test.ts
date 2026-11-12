import { describe, expect, it } from 'vitest';
import { ancestry, contentsOf, folderPaths, importRows } from './tree.js';

const folders = [
  { id: 'f1', parentId: null, name: 'Guides' },
  { id: 'f2', parentId: 'f1', name: 'Network' },
  { id: 'f0', parentId: null, name: 'archive' },
];
const page = (id: string, folderId: string | null, title: string) => ({
  id,
  departmentId: 'd1',
  folderId,
  title,
  version: 1,
  updatedAt: '2026-11-12T00:00:00Z',
  updatedBy: null,
});

describe('wiki tree helpers', () => {
  it('builds folder paths and breadcrumbs', () => {
    expect(folderPaths(folders).get('f2')).toBe('Guides / Network');
    expect(ancestry('f2', folders).map((f) => f.name)).toEqual(['Guides', 'Network']);
    expect(ancestry(null, folders)).toEqual([]);
  });

  it('lists what a folder holds, sorted by name regardless of case', () => {
    const pages = [page('p2', null, 'zeta'), page('p1', null, 'Alpha'), page('p3', 'f1', 'Inside')];
    const root = contentsOf(null, folders, pages);
    expect(root.folders.map((f) => f.name)).toEqual(['archive', 'Guides']);
    expect(root.pages.map((p) => p.title)).toEqual(['Alpha', 'zeta']);
    expect(contentsOf('f1', folders, pages).pages.map((p) => p.title)).toEqual(['Inside']);
  });

  it('orders Wiki.js folders right before their pages', () => {
    const at = (id: number, path: string) => ({
      id,
      path,
      locale: 'en',
      title: path,
      updatedAt: '2025-01-01T00:00:00Z',
    });
    const rows = importRows([
      at(1, 'home'),
      at(2, 'docs/setup'),
      at(3, 'docs/net/vpn'),
      at(4, 'docs'),
    ]);
    expect(rows.map((r) => (r.kind === 'folder' ? `${r.path}/` : r.page.path))).toEqual([
      'docs',
      'docs/',
      'docs/net/',
      'docs/net/vpn',
      'docs/setup',
      'home',
    ]);
    expect(rows.find((r) => r.kind === 'folder' && r.path === 'docs/net')!.depth).toBe(1);
  });
});
