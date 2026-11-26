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
  wikiLinks,
  guessWikiTarget,
  WIKI_LINK_PATTERN,
  headingSlug,
  headingSlugs,
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

describe('wiki links (ADR 0018)', () => {
  it('has no bounded {m,n} repeats, which make PostgreSQL extract links ten times slower', () => {
    expect(WIKI_LINK_PATTERN).not.toMatch(/\{\d+,\d*\}/);
  });

  it('still reads long [[titles]] and aliases', () => {
    const title = 'x'.repeat(250);
    expect(wikiLinks(`[[${title}|alias]]`)).toEqual([
      { kind: 'wiki_page', ref: title, byTitle: true },
    ]);
  });

  const page = '0190a0b0-0000-7000-8000-000000000001';
  const board = '0190a0b0-0000-7000-8000-000000000002';

  it('finds every kind of link once, in reading order', () => {
    const content = [
      `See [[Onboarding]] and [[VPN setup|the VPN guide]], then [setup](/wiki/page/${page}).`,
      `Tracked in [HELP-12](/issue/help-12) and [REQ-3](https://ordler.test/requests/req-3).`,
      '',
      `[Network](/whiteboards/${board})`,
      '',
      `Again: [[onboarding]] and /wiki/page/${page}.`,
    ].join('\n');
    expect(wikiLinks(content)).toEqual([
      { kind: 'wiki_page', ref: 'Onboarding', byTitle: true },
      { kind: 'wiki_page', ref: 'VPN setup', byTitle: true },
      { kind: 'wiki_page', ref: page },
      { kind: 'issue', ref: 'HELP-12' },
      { kind: 'request', ref: 'REQ-3' },
      { kind: 'whiteboard', ref: board },
    ]);
  });

  it('ignores empty or unterminated wikilinks', () => {
    expect(wikiLinks('[[]] and [[open and /wiki/page/not-a-uuid')).toEqual([]);
  });

  it('guesses what a bare reference names', () => {
    expect(guessWikiTarget('REQ-3')).toBe('request');
    expect(guessWikiTarget('help-12')).toBe('issue');
    expect(guessWikiTarget(page)).toBe('wiki_page');
    expect(guessWikiTarget('Onboarding')).toBe('wiki_page');
  });
});

describe('heading slugs', () => {
  it.each([
    ['Partner selection', 'partner-selection'],
    ['Выбор партнёра', 'выбор-партнёра'],
    ['Заключение', 'заключение'],
    ['Şəhər üçün ağıllı çözüm', 'şəhər-üçün-ağıllı-çözüm'],
    ['  Step 1: Install (v2.0)!  ', 'step-1-install-v20'],
    ['🚀 Launch plan', '-launch-plan'],
    ['snake_case & kebab-case', 'snake_case--kebab-case'],
    ['C++ / C#', 'c--c'],
  ])('slugs %j as %j', (text, slug) => {
    expect(headingSlug(text)).toBe(slug);
  });

  it('suffixes repeated headings', () => {
    expect(headingSlugs(['Notes', 'Notes', 'Notes'])).toEqual(['notes', 'notes-1', 'notes-2']);
  });

  it('skips suffixes a real heading already uses', () => {
    expect(headingSlugs(['Intro', 'Intro-1', 'Intro'])).toEqual(['intro', 'intro-1', 'intro-2']);
  });
});
