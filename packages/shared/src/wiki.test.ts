import { describe, expect, it } from 'vitest';
import {
  splitWikiContent,
  wikiImportConnectSchema,
  wikiWhiteboardEmbed,
  wikiWhiteboards,
  wikiImportFolders,
  wikiImportStartSchema,
  wikiPageUpdateSchema,
  wikiPathSelected,
} from './wiki.js';

describe('wiki schemas', () => {
  it('needs something to change in a page edit', () => {
    expect(wikiPageUpdateSchema.safeParse({ baseVersion: 2 }).success).toBe(false);
    expect(wikiPageUpdateSchema.safeParse({ content: '', baseVersion: 2 }).success).toBe(true);
    expect(wikiPageUpdateSchema.safeParse({ folderId: null }).success).toBe(true);
  });

  it('connects to Wiki.js over https only and needs a choice to start', () => {
    const base = { department: '0190c8a0-0000-7000-8000-000000000001', token: 'x'.repeat(30) };
    expect(
      wikiImportConnectSchema.safeParse({ ...base, baseUrl: 'https://wiki.test' }).success,
    ).toBe(true);
    expect(
      wikiImportConnectSchema.safeParse({ ...base, baseUrl: 'http://wiki.test' }).success,
    ).toBe(false);
    expect(wikiImportStartSchema.safeParse({}).success).toBe(false);
    expect(wikiImportStartSchema.parse({ paths: ['docs'] })).toEqual({
      paths: ['docs'],
      pageIds: [],
    });
  });
});

describe('Wiki.js paths', () => {
  it('derives folders from page paths', () => {
    expect(
      wikiImportFolders([{ path: 'home' }, { path: 'docs/setup/linux' }, { path: 'docs/faq' }]),
    ).toEqual(['docs', 'docs/setup']);
  });

  it('selects a folder with everything under it, not look-alike siblings', () => {
    expect(wikiPathSelected('docs/setup', ['docs'])).toBe(true);
    expect(wikiPathSelected('docs', ['docs'])).toBe(true);
    expect(wikiPathSelected('docs-old/a', ['docs'])).toBe(false);
  });
});

describe('whiteboards embedded in wiki pages', () => {
  const id = '0193a000-0000-7000-8000-000000000001';

  it('embeds a board that is a paragraph of its own, not a link inside a sentence', () => {
    const content = `# Network\n\nIntro\n\n[Office map](/whiteboards/${id})\n\nSee [the map](/whiteboards/${id}) above.`;
    expect(splitWikiContent(content)).toEqual([
      { kind: 'markdown', markdown: '# Network\n\nIntro' },
      { kind: 'whiteboard', id, title: 'Office map' },
      { kind: 'markdown', markdown: `See [the map](/whiteboards/${id}) above.` },
    ]);
    expect(wikiWhiteboards(content)).toEqual([id]);
  });

  it('accepts absolute links and builds embeds that round-trip', () => {
    const embed = wikiWhiteboardEmbed(id, 'Flow [v2]');
    expect(embed).toBe(`[Flow  v2](/whiteboards/${id})`);
    expect(splitWikiContent(`https://x\n\n[A](https://ordler.test/whiteboards/${id})`)).toEqual([
      { kind: 'markdown', markdown: 'https://x' },
      { kind: 'whiteboard', id, title: 'A' },
    ]);
    expect(splitWikiContent(embed)).toEqual([{ kind: 'whiteboard', id, title: 'Flow  v2' }]);
  });
});
