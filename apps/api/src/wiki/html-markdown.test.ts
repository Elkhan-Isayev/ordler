import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './html-markdown.js';

describe('htmlToMarkdown', () => {
  it('converts headings, marks, links and images', () => {
    expect(
      htmlToMarkdown(
        '<h1>Title</h1><p>Some <strong>bold</strong>, <em>italic</em> and <s>old</s> text with <code>x = 1</code>.</p>' +
          '<p><a href="/en/setup">Setup</a> <img src="/uploads/a.png" alt="A"></p>',
      ),
    ).toBe(
      '# Title\n\nSome **bold**, *italic* and ~~old~~ text with `x = 1`.\n\n[Setup](/en/setup) ![A](/uploads/a.png)',
    );
  });

  it('keeps nested and ordered lists, task lists and quotes', () => {
    expect(
      htmlToMarkdown(
        '<ul><li>One<ul><li>Inner</li></ul></li><li>Two</li></ul>' +
          '<ol start="3"><li>Third</li><li>Fourth</li></ol>' +
          '<ul><li><input type="checkbox" checked>Done</li><li><input type="checkbox">Open</li></ul>' +
          '<blockquote><p>Quoted</p><p>Twice</p></blockquote>',
      ),
    ).toBe(
      '- One\n   - Inner\n- Two\n\n3. Third\n4. Fourth\n\n- [x] Done\n- [ ] Open\n\n> Quoted\n>\n> Twice',
    );
  });

  it('turns code blocks and tables into their Markdown forms', () => {
    expect(
      htmlToMarkdown(
        '<pre><code class="language-bash">echo 1\necho 2\n</code></pre>' +
          '<table><thead><tr><th>Name</th><th>Port</th></tr></thead>' +
          '<tbody><tr><td>SSH</td><td>22</td></tr><tr><td>a|b</td></tr></tbody></table>',
      ),
    ).toBe(
      '```bash\necho 1\necho 2\n```\n\n| Name | Port |\n| --- | --- |\n| SSH | 22 |\n| a\\|b |  |',
    );
  });

  it('decodes entities, drops scripts and keeps unknown elements as text', () => {
    expect(
      htmlToMarkdown(
        '<div><p>Tom &amp; Jerry&nbsp;&lt;3</p><script>alert(1)</script><custom-box>Kept</custom-box></div><hr><p>End<br>line</p>',
      ),
    ).toBe('Tom & Jerry <3\n\nKept\n\n---\n\nEnd\\\nline');
  });
});
