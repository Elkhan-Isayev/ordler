import type { WikiImportSourcePage } from '@ordler/shared';
import { SourceError, sourceJson, type HttpFetch } from '../imports/sources/types.js';

export interface WikiJsPage extends WikiImportSourcePage {
  content: string;
  /** `markdown` for the Markdown editor; `html` for the visual and raw HTML editors. */
  contentType: string;
  createdAt: string;
}

/** Files a page may link to that are worth copying into Ordler. */
const FILE_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|avif|svg|pdf|docx?|xlsx?|pptx?|odt|ods|odp|txt|csv|zip|7z|mp4|webm|mp3)$/i;

/**
 * Wiki.js 2.x GraphQL API with an API key (Administration → API Access), ADR 0017. Ordler only
 * reads. The key travels in the Authorization header and goes nowhere but the wiki's origin.
 */
export class WikiJsSource {
  readonly origin: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetch: HttpFetch,
  ) {
    this.origin = new URL(baseUrl).origin;
  }

  private async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const result = (await sourceJson(this.fetch, `${this.origin}/graphql`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}` },
      body: { query, variables },
    })) as { data?: T; errors?: Array<{ message: string }> };
    if (result.errors?.length) {
      const message = result.errors[0]!.message;
      const auth = /forbidden|unauthori[sz]ed|not authenticated|invalid.*token|jwt/i.test(message);
      throw new SourceError(auth ? 'import_auth_failed' : 'import_source_failed', message);
    }
    if (!result.data) throw new SourceError('import_source_failed', 'Empty answer from Wiki.js');
    return result.data;
  }

  /** Every page the key may read, by path; also checks the key works. */
  async pages(): Promise<WikiImportSourcePage[]> {
    const data = await this.query<{
      pages: { list: Array<WikiImportSourcePage & { updatedAt: string }> };
    }>('query { pages { list(limit: 100000, orderBy: PATH) { id path locale title updatedAt } } }');
    return data.pages.list.map((p) => ({
      id: p.id,
      path: p.path,
      locale: p.locale,
      title: p.title || p.path.split('/').pop() || p.path,
      updatedAt: p.updatedAt,
    }));
  }

  async page(id: number): Promise<WikiJsPage> {
    const data = await this.query<{ pages: { single: WikiJsPage | null } }>(
      `query Page($id: Int!) { pages { single(id: $id) {
        id path locale title content contentType createdAt updatedAt
      } } }`,
      { id },
    );
    if (!data.pages.single) throw new SourceError('import_source_failed', `Page ${id} is gone`);
    return data.pages.single;
  }

  /** A file the wiki serves, fetched with the key; only from the wiki's own origin. */
  async download(path: string): Promise<{ data: Buffer; contentType: string }> {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin) {
      throw new SourceError('import_source_failed', 'Refusing to download from another site');
    }
    const response = await this.fetch(url.toString(), {
      method: 'GET',
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new SourceError('import_source_failed', `Download failed (HTTP ${response.status})`);
    }
    return {
      data: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }
}

/** Markdown link and image targets that point into the wiki itself (`/…`, not `//host`). */
const LOCAL_TARGET = /(!?\[[^\]]*\]\()(\/(?!\/)[^\s)]*)((?:\s+=\d*x\d*)?(?:\s+"[^"]*")?\))/g;

export interface LocalReference {
  /** The path as written, e.g. `/uploads/diagram.png` or `/en/setup#install`. */
  target: string;
  isFile: boolean;
}

export function localReferences(markdown: string): LocalReference[] {
  const seen = new Map<string, LocalReference>();
  for (const match of markdown.matchAll(LOCAL_TARGET)) {
    const target = match[2]!;
    const path = target.split(/[?#]/)[0]!;
    seen.set(target, { target, isFile: FILE_EXTENSIONS.test(path) });
  }
  return [...seen.values()];
}

/**
 * Replaces local link targets. `resolve` returns the new target or undefined to keep it;
 * Wiki.js image sizes (` =300x`) are dropped because Ordler's Markdown has no such syntax.
 */
export function rewriteTargets(
  markdown: string,
  resolve: (target: string) => string | undefined,
): string {
  return markdown.replace(LOCAL_TARGET, (whole, open: string, target: string, close: string) => {
    const next = resolve(target);
    if (next === undefined) return whole;
    return `${open}${next}${close.replace(/^\s+=\d*x\d*/, '')}`;
  });
}

/** A wiki page path from a link: drops the locale prefix, anchors and trailing slashes. */
export function pagePathOf(target: string, locales: ReadonlySet<string>): string {
  const [path] = target.split(/[?#]/);
  const parts = decodeURIComponent(path!).split('/').filter(Boolean);
  if (parts.length > 1 && locales.has(parts[0]!)) parts.shift();
  return parts.join('/');
}
