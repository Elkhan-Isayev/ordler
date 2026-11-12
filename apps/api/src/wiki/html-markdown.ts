import type { ChildNode, Element } from 'domhandler';
import { parseDocument } from 'htmlparser2';

/**
 * HTML → Markdown for pages written in Wiki.js's visual editor (ADR 0017). Covers what that
 * editor produces: headings, marks, links, images, lists, quotes, code, tables. Anything else
 * keeps its text, so nothing written is lost.
 */
export function htmlToMarkdown(html: string): string {
  const document = parseDocument(html, { decodeEntities: true });
  return blocks(document.children, { list: 0 })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface Context {
  /** Nesting depth of lists, for indentation. */
  list: number;
}

const BLOCK = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'pre',
  'blockquote',
  'table',
  'hr',
]);
const SKIP = new Set(['script', 'style', 'head', 'noscript', 'template']);

function isElement(node: ChildNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

function text(node: ChildNode): string {
  if (node.type === 'text') return node.data;
  if (isElement(node)) return node.children.map(text).join('');
  return '';
}

/** Block-level rendering: paragraphs separated by blank lines. */
function blocks(nodes: ChildNode[], ctx: Context): string {
  let out = '';
  let inline = '';
  const flush = () => {
    const trimmed = inline.replace(/[ \t]+\n/g, '\n').trim();
    if (trimmed) out += `${trimmed}\n\n`;
    inline = '';
  };
  for (const node of nodes) {
    if (isElement(node) && BLOCK.has(node.name)) {
      flush();
      out += block(node, ctx);
    } else {
      inline += inlineOf(node);
    }
  }
  flush();
  return out;
}

function block(el: Element, ctx: Context): string {
  const name = el.name;
  if (/^h[1-6]$/.test(name)) {
    return `${'#'.repeat(Number(name[1]))} ${inlines(el.children).trim()}\n\n`;
  }
  switch (name) {
    case 'hr':
      return '---\n\n';
    case 'pre': {
      const code = el.children.find((c): c is Element => isElement(c) && c.name === 'code');
      const language = /language-([\w-]+)/.exec(code?.attribs.class ?? '')?.[1] ?? '';
      const body = text(code ?? el).replace(/\n$/, '');
      return `\`\`\`${language}\n${body}\n\`\`\`\n\n`;
    }
    case 'blockquote':
      return `${blocks(el.children, ctx)
        .trim()
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n')}\n\n`;
    case 'ul':
    case 'ol':
      return `${list(el, ctx)}\n`;
    case 'table':
      return table(el);
    default:
      return blocks(el.children, ctx);
  }
}

function list(el: Element, ctx: Context): string {
  const ordered = el.name === 'ol';
  const indent = '   '.repeat(ctx.list);
  let n = Number(el.attribs.start ?? 1) || 1;
  const lines: string[] = [];
  for (const item of el.children) {
    if (!isElement(item) || item.name !== 'li') continue;
    const marker = ordered ? `${n++}.` : '-';
    const nested = item.children.filter(
      (c): c is Element => isElement(c) && (c.name === 'ul' || c.name === 'ol'),
    );
    const own = item.children.filter((c) => !nested.includes(c as Element));
    const checkbox = own.find(
      (c): c is Element => isElement(c) && c.name === 'input' && c.attribs.type === 'checkbox',
    );
    const task = checkbox ? (checkbox.attribs.checked !== undefined ? '[x] ' : '[ ] ') : '';
    const body = blocks(own, { list: ctx.list + 1 })
      .trim()
      .replace(/\n\n+/g, '\n')
      .replace(/\n/g, `\n${indent}   `);
    lines.push(`${indent}${marker} ${task}${body}`);
    for (const sub of nested) lines.push(list(sub, { list: ctx.list + 1 }).trimEnd());
  }
  return `${lines.join('\n')}\n`;
}

function table(el: Element): string {
  const rows: string[][] = [];
  const visit = (node: ChildNode) => {
    if (!isElement(node)) return;
    if (node.name === 'tr') {
      rows.push(
        node.children
          .filter((c): c is Element => isElement(c) && (c.name === 'td' || c.name === 'th'))
          .map((cell) => inlines(cell.children).trim().replace(/\|/g, '\\|').replace(/\n/g, ' ')),
      );
      return;
    }
    node.children.forEach(visit);
  };
  el.children.forEach(visit);
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array<string>(width - r.length).fill('')];
  const [head, ...body] = rows;
  return `${[
    `| ${pad(head!).join(' | ')} |`,
    `| ${Array<string>(width).fill('---').join(' | ')} |`,
    ...body.map((r) => `| ${pad(r).join(' | ')} |`),
  ].join('\n')}\n\n`;
}

function inlines(nodes: ChildNode[]): string {
  return nodes.map(inlineOf).join('');
}

function wrap(mark: string, content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return content;
  // Keep surrounding spaces outside the marks, or Markdown would not see them as marks.
  const lead = content.startsWith(' ') ? ' ' : '';
  const tail = content.endsWith(' ') ? ' ' : '';
  return `${lead}${mark}${trimmed}${mark}${tail}`;
}

function inlineOf(node: ChildNode): string {
  if (node.type === 'text') return node.data.replace(/\s+/g, ' ');
  if (!isElement(node) || SKIP.has(node.name)) return '';
  const inner = () => inlines(node.children);
  switch (node.name) {
    case 'br':
      // A backslash keeps the hard line break; trailing spaces would be trimmed away.
      return '\\\n';
    case 'strong':
    case 'b':
      return wrap('**', inner());
    case 'em':
    case 'i':
      return wrap('*', inner());
    case 's':
    case 'del':
    case 'strike':
      return wrap('~~', inner());
    case 'code':
      return `\`${text(node)}\``;
    case 'a': {
      const href = node.attribs.href;
      const label = inner().trim() || href || '';
      return href ? `[${label}](${href})` : label;
    }
    case 'img': {
      const src = node.attribs.src;
      return src ? `![${node.attribs.alt ?? ''}](${src})` : '';
    }
    case 'input':
      return '';
    default:
      return BLOCK.has(node.name) ? `\n\n${blocks(node.children, { list: 0 })}` : inner();
  }
}
