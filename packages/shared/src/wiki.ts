import { z } from 'zod';
import type { MemberRef } from './issues.js';

/**
 * Wiki (SPEC §5.6, ADR 0017): every department has its own space of nested folders and
 * Markdown pages. Pages keep an append-only revision history; edits use optimistic locking.
 */

/** Who can read a department's space besides the department itself. */
export const WIKI_VISIBILITIES = ['department', 'organization'] as const;
export type WikiVisibility = (typeof WIKI_VISIBILITIES)[number];

/** Pages are Markdown, like issue descriptions; 1 MB keeps a page well within one row. */
export const WIKI_MAX_CONTENT = 1_000_000;
/** Folders may nest this deep; deeper trees are hard to navigate and to import. */
export const WIKI_MAX_DEPTH = 8;

const nameSchema = z.string().trim().min(1).max(200);
const contentSchema = z.string().max(WIKI_MAX_CONTENT);

export const wikiFolderCreateSchema = z.object({
  department: z.uuid(),
  /** Parent folder; omitted for a folder at the root of the space. */
  parentId: z.uuid().nullable().optional(),
  name: nameSchema,
});
export type WikiFolderCreate = z.input<typeof wikiFolderCreateSchema>;

export const wikiFolderUpdateSchema = z
  .object({ name: nameSchema.optional(), parentId: z.uuid().nullable().optional() })
  .refine((v) => v.name !== undefined || v.parentId !== undefined, 'Nothing to change');
export type WikiFolderUpdate = z.input<typeof wikiFolderUpdateSchema>;

export const wikiPageCreateSchema = z.object({
  department: z.uuid(),
  folderId: z.uuid().nullable().optional(),
  title: nameSchema,
  content: contentSchema.default(''),
});
export type WikiPageCreate = z.input<typeof wikiPageCreateSchema>;

export const wikiPageUpdateSchema = z
  .object({
    title: nameSchema.optional(),
    content: contentSchema.optional(),
    /** Moves the page; null puts it at the root of its space. */
    folderId: z.uuid().nullable().optional(),
    /**
     * The version the edit started from. A newer stored version answers `wiki_conflict`, so
     * nobody silently overwrites a colleague's changes. Omitted: the edit applies to the latest.
     */
    baseVersion: z.number().int().min(1).optional(),
  })
  .refine(
    (v) => v.title !== undefined || v.content !== undefined || v.folderId !== undefined,
    'Nothing to change',
  );
export type WikiPageUpdate = z.input<typeof wikiPageUpdateSchema>;

export const wikiSpaceUpdateSchema = z.object({ visibility: z.enum(WIKI_VISIBILITIES) });
export type WikiSpaceUpdate = z.input<typeof wikiSpaceUpdateSchema>;

export interface WikiSpace {
  department: { id: string; name: string };
  visibility: WikiVisibility;
  pages: number;
  /** Create and edit pages and folders (wiki.edit in the department). */
  canEdit: boolean;
  /** Visibility, deleting any page or folder, Wiki.js import (department.update). */
  canManage: boolean;
}

export interface WikiFolder {
  id: string;
  parentId: string | null;
  name: string;
}

export interface WikiPageSummary {
  id: string;
  departmentId: string;
  folderId: string | null;
  title: string;
  version: number;
  updatedAt: string;
  updatedBy: MemberRef | null;
}

/** GET /api/wiki/spaces/:departmentId: the whole tree of one space. */
export interface WikiTree {
  space: WikiSpace;
  folders: WikiFolder[];
  pages: WikiPageSummary[];
}

export interface WikiPageView extends WikiPageSummary {
  department: { id: string; name: string };
  /** Folders from the root down to the page's folder, for breadcrumbs. */
  path: WikiFolder[];
  content: string;
  createdAt: string;
  createdBy: MemberRef | null;
  canEdit: boolean;
  /** Delete or move the page: its author with edit rights, or department.update. */
  canManage: boolean;
}

export interface WikiRevision {
  version: number;
  title: string;
  author: MemberRef | null;
  createdAt: string;
}

export interface WikiRevisionView extends WikiRevision {
  content: string;
}

export interface WikiSearchHit {
  id: string;
  title: string;
  department: { id: string; name: string };
  /** A short piece of text around the first match. */
  snippet: string;
  updatedAt: string;
}

/** Import from Wiki.js 2.x by API key (ADR 0017). */
export const wikiImportConnectSchema = z.object({
  department: z.uuid(),
  /** Folder that receives the imported tree; omitted for the root of the space. */
  folderId: z.uuid().nullable().optional(),
  /** `https` only, like Jira imports: the API key must not cross the network in clear. */
  baseUrl: z.url({ protocol: /^https$/ }).max(300),
  token: z.string().trim().min(20).max(4000),
});
export type WikiImportConnect = z.input<typeof wikiImportConnectSchema>;

export const wikiImportStartSchema = z
  .object({
    /** Folders by path (`docs/setup`): every page under them. */
    paths: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
    /** Single pages by their Wiki.js id. */
    pageIds: z.array(z.number().int().min(1)).max(5000).default([]),
  })
  .refine((v) => v.paths.length + v.pageIds.length > 0, 'Choose at least one page or folder');
export type WikiImportStart = z.input<typeof wikiImportStartSchema>;

export type WikiImportStatus = 'draft' | 'running' | 'completed' | 'failed' | 'canceled';

export interface WikiImportCounts {
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  files: number;
}

export interface WikiImportView {
  id: string;
  department: { id: string; name: string };
  folderId: string | null;
  baseUrl: string;
  status: WikiImportStatus;
  total: number;
  counts: WikiImportCounts;
  /** Pages that could not be imported, with the reason. */
  report: Array<{ path: string; reason: string }>;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** A page offered for import, from the Wiki.js page list. */
export interface WikiImportSourcePage {
  id: number;
  path: string;
  locale: string;
  title: string;
  updatedAt: string;
}

export const WIKI_ERROR_CODES = [
  'wiki_conflict',
  'wiki_folder_not_empty',
  'wiki_too_deep',
] as const;
export type WikiErrorCode = (typeof WIKI_ERROR_CODES)[number];

/** Folders of a Wiki.js page list: every path prefix that has pages under it. */
export function wikiImportFolders(pages: readonly Pick<WikiImportSourcePage, 'path'>[]): string[] {
  const folders = new Set<string>();
  for (const page of pages) {
    const parts = page.path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  return [...folders].sort();
}

/** Whether a page falls under a chosen folder path or is the page itself. */
export function wikiPathSelected(path: string, folders: readonly string[]): boolean {
  return folders.some((folder) => path === folder || path.startsWith(`${folder}/`));
}

/**
 * Diagrams in wiki pages are whiteboards (SPEC §5.5): a paragraph that is only a link to a
 * board, `[Title](/whiteboards/<id>)`, shows the live board in its place. Plain Markdown keeps
 * the page readable in exports, the API and MCP.
 */
const EMBED_LINE =
  /^\[([^\]\n]*)\]\((?:https?:\/\/[^/\s)]+)?\/whiteboards\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)$/;

export type WikiContentPart =
  { kind: 'markdown'; markdown: string } | { kind: 'whiteboard'; id: string; title: string };

/** The page split into Markdown runs and embedded whiteboards, in reading order. */
export function splitWikiContent(content: string): WikiContentPart[] {
  const parts: WikiContentPart[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const markdown = buffer.join('\n').trim();
    if (markdown) parts.push({ kind: 'markdown', markdown });
    buffer = [];
  };
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    const match = EMBED_LINE.exec(line.trim());
    // Only a paragraph of its own embeds; a link inside a sentence stays a link.
    const alone = (lines[i - 1] ?? '').trim() === '' && (lines[i + 1] ?? '').trim() === '';
    if (match && alone) {
      flush();
      parts.push({ kind: 'whiteboard', id: match[2]!, title: match[1]! });
    } else {
      buffer.push(line);
    }
  });
  flush();
  return parts;
}

/** Ids of the whiteboards a page embeds, once each. */
export function wikiWhiteboards(content: string): string[] {
  return [
    ...new Set(splitWikiContent(content).flatMap((p) => (p.kind === 'whiteboard' ? [p.id] : []))),
  ];
}

/** The Markdown that embeds a whiteboard, as its own paragraph. */
export function wikiWhiteboardEmbed(id: string, title: string): string {
  return `[${title.replace(/[[\]\n]/g, ' ').trim() || 'Whiteboard'}](/whiteboards/${id})`;
}
