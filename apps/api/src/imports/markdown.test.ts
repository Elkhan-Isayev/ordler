import { describe, expect, it } from 'vitest';
import { adfToMarkdown, wikiToMarkdown } from './markdown.js';

const text = (value: string, marks?: Array<{ type: string; attrs?: object }>) => ({
  type: 'text',
  text: value,
  marks,
});

describe('adfToMarkdown', () => {
  it('converts paragraphs, marks, headings, lists, code, quotes and mentions', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [text('Steps')] },
        {
          type: 'paragraph',
          content: [
            text('Open '),
            text('Settings', [{ type: 'strong' }]),
            text(' and see '),
            text('docs', [{ type: 'link', attrs: { href: 'https://example.test' } }]),
            { type: 'mention', attrs: { text: '@Jane Doe' } },
          ],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [text('one')] }] },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [text('two')] },
                {
                  type: 'orderedList',
                  content: [
                    {
                      type: 'listItem',
                      content: [{ type: 'paragraph', content: [text('nested')] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'sql' }, content: [text('select 1;')] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [text('quoted')] }] },
        {
          type: 'mediaSingle',
          content: [{ type: 'media', attrs: { id: 'abc', alt: 'shot.png' } }],
        },
      ],
    };
    expect(adfToMarkdown(doc)).toBe(
      [
        '## Steps',
        'Open **Settings** and see [docs](https://example.test)@Jane Doe',
        '- one\n- two\n    1. nested',
        '```sql\nselect 1;\n```',
        '> quoted',
        '![shot.png](jira-attachment:shot.png)',
      ].join('\n\n'),
    );
  });

  it('renders tables and tolerates empty input', () => {
    const cell = (value: string) => ({
      type: 'tableCell',
      content: [{ type: 'paragraph', content: [text(value)] }],
    });
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('A'), cell('B')] },
            { type: 'tableRow', content: [cell('1'), cell('2|3')] },
          ],
        },
      ],
    };
    expect(adfToMarkdown(doc)).toBe('| A | B |\n| --- | --- |\n| 1 | 2\\|3 |');
    expect(adfToMarkdown(null)).toBe('');
  });
});

describe('wikiToMarkdown', () => {
  it('converts the common wiki markup', () => {
    const wiki = [
      'h1. Title',
      'Some *bold* and _italic_ text with {{code}} and [link|https://example.test].',
      '* item',
      '** nested',
      '# first',
      'bq. quote',
      '!screen.png|thumbnail!',
      '{code:java}',
      'int a = *1*;',
      '{code}',
      'Ping [~jane]',
    ].join('\n');
    expect(wikiToMarkdown(wiki)).toBe(
      [
        '# Title',
        'Some **bold** and _italic_ text with `code` and [link](https://example.test).',
        '- item',
        '  - nested',
        '1. first',
        '> quote',
        '![screen.png](jira-attachment:screen.png)',
        '```java\nint a = *1*;\n```',
        'Ping @jane',
      ].join('\n'),
    );
  });
});
