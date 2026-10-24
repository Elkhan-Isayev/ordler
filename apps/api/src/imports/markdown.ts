/**
 * Jira text to Markdown (ADR 0010): Atlassian Document Format (Cloud, REST v3) and wiki markup
 * (Server/DC, REST v2). Only the subset Jira produces; unknown nodes keep their text.
 * Media become `jira-attachment:<id or name>` links that the importer rewrites after upload.
 */

interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export const ATTACHMENT_REF = 'jira-attachment:';

function marks(text: string, node: AdfNode): string {
  let out = text;
  for (const mark of node.marks ?? []) {
    if (mark.type === 'strong') out = `**${out}**`;
    else if (mark.type === 'em') out = `_${out}_`;
    else if (mark.type === 'strike') out = `~~${out}~~`;
    else if (mark.type === 'code') out = `\`${out}\``;
    else if (mark.type === 'link' && typeof mark.attrs?.href === 'string')
      out = `[${out}](${mark.attrs.href})`;
  }
  return out;
}

function inline(nodes: AdfNode[] = []): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return marks(node.text ?? '', node);
        case 'hardBreak':
          return '\n';
        case 'mention':
          return `@${String(node.attrs?.text ?? '').replace(/^@/, '')}`;
        case 'emoji':
          return String(node.attrs?.text ?? node.attrs?.shortName ?? '');
        case 'inlineCard':
          return String(node.attrs?.url ?? '');
        default:
          return inline(node.content);
      }
    })
    .join('');
}

// ADF media ids belong to Atlassian's media service, not to attachments; the file name matches.
function media(node: AdfNode): string {
  const id = String(node.attrs?.alt ?? node.attrs?.id ?? '');
  const name = String(node.attrs?.alt ?? node.attrs?.id ?? 'attachment');
  return id ? `![${name}](${ATTACHMENT_REF}${id})` : '';
}

function block(node: AdfNode, depth = 0): string {
  const children = node.content ?? [];
  switch (node.type) {
    case 'doc':
      return children
        .map((c) => block(c, depth))
        .filter(Boolean)
        .join('\n\n');
    case 'paragraph':
      return inline(children);
    case 'heading':
      return `${'#'.repeat(Math.min(6, Number(node.attrs?.level ?? 1)))} ${inline(children)}`;
    case 'bulletList':
    case 'orderedList':
      return children
        .map((item, index) => {
          const bullet = node.type === 'orderedList' ? `${index + 1}.` : '-';
          const [first, ...rest] = (item.content ?? []).map((c) => block(c, depth + 1));
          const pad = '  '.repeat(depth);
          return [
            `${pad}${bullet} ${first ?? ''}`,
            ...rest.map((r) => r.replace(/^/gm, `${pad}  `)),
          ].join('\n');
        })
        .join('\n');
    case 'codeBlock':
      return `\`\`\`${String(node.attrs?.language ?? '')}\n${inline(children)}\n\`\`\``;
    case 'blockquote':
    case 'panel':
      return children
        .map((c) => block(c, depth))
        .join('\n\n')
        .replace(/^/gm, '> ');
    case 'rule':
      return '---';
    case 'mediaSingle':
    case 'mediaGroup':
      return children.map(media).filter(Boolean).join('\n');
    case 'media':
      return media(node);
    case 'table': {
      const rows = children.map((row) =>
        (row.content ?? []).map((cell) =>
          (cell.content ?? [])
            .map((c) => block(c, depth))
            .join(' ')
            .replace(/\|/g, '\\|')
            .replace(/\n/g, ' '),
        ),
      );
      if (rows.length === 0) return '';
      const width = Math.max(...rows.map((r) => r.length));
      const line = (cells: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
      return [line(rows[0]!), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n');
    }
    default:
      return children.length > 0
        ? children.map((c) => block(c, depth)).join('\n\n')
        : inline([node]);
  }
}

export function adfToMarkdown(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return typeof doc === 'string' ? wikiToMarkdown(doc) : '';
  return block(doc as AdfNode).trim();
}

/** Jira wiki markup (Server/DC) to Markdown. */
export function wikiToMarkdown(text: string): string {
  const code: string[] = [];
  // Code and noformat blocks are kept verbatim.
  let out = text.replace(
    /(?<!\{)\{(code|noformat)(?::([^}]*))?\}(?!\})([\s\S]*?)\{\1\}/g,
    (_m, _tag, lang: string | undefined, body: string) => {
      code.push(
        `\`\`\`${(lang ?? '').split('|')[0]!.replace(/^language=/, '')}\n${body.replace(/^\n|\n$/g, '')}\n\`\`\``,
      );
      return `\u0000${code.length - 1}\u0000`;
    },
  );
  out = out
    .replace(/^bq\.\s*(.*)$/gm, '> $1')
    .replace(/^(\*+|#+)\s+(.*)$/gm, (_m, bullets: string, item: string) => {
      const pad = '  '.repeat(bullets.length - 1);
      return `${pad}${bullets.endsWith('#') ? '1.' : '-'} ${item}`;
    })
    .replace(
      /!([^!\s|]+)(?:\|[^!]*)?!/g,
      (_m, name: string) => `![${name}](${ATTACHMENT_REF}${name})`,
    )
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, '[$1]($2)')
    .replace(/\[~([^\]]+)\]/g, '@$1')
    .replace(/\{\{([^}]+)\}\}/g, '`$1`')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,;:!?])/g, '$1**$2**')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:!?])/g, '$1_$2_')
    .replace(/(^|\s)-([^-\n]+)-(?=\s|$|[.,;:!?])/g, '$1~~$2~~')
    .replace(/^----\s*$/gm, '---')
    // Headings last: their `#` would otherwise read as a numbered list.
    .replace(
      /^h([1-6])\.\s*(.*)$/gm,
      (_m, level: string, title: string) => `${'#'.repeat(Number(level))} ${title}`,
    );
  // NUL-delimited placeholders cannot occur in Jira text, so code blocks come back intact.
  // eslint-disable-next-line no-control-regex
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => code[Number(i)]!).trim();
}
