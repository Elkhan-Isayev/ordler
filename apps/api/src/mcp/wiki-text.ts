import { safeSlice } from './fit-result.js';

/** How much page text get_wiki_page returns by default: leaves room in the 60 000 result. */
export const WIKI_PAGE_CHARS = 40_000;
/** The most one get_wiki_page call may return. */
export const WIKI_PAGE_MAX_CHARS = 50_000;

/** An edit an agent asked for that does not fit the page; reported back as a tool error. */
export class WikiEditError extends Error {}

export interface TextWindow {
  content: string;
  contentLength: number;
  offset: number;
  /** Where the next part starts; null when this part reaches the end. */
  nextOffset: number | null;
  /** True when `content` is not the whole page. */
  truncated: boolean;
}

/**
 * Part of a page text from `offset`, at most `maxChars` long. A cut in the middle of the
 * window moves back to the last line break when one is near, so parts end on whole lines.
 */
export function textWindow(text: string, offset: number, maxChars: number): TextWindow {
  const start = Math.min(offset, text.length);
  let content = safeSlice(text, maxChars, start);
  let end = start + content.length;
  if (end < text.length) {
    const lineEnd = content.lastIndexOf('\n');
    if (lineEnd >= Math.floor(content.length * 0.8)) {
      content = content.slice(0, lineEnd + 1);
      end = start + content.length;
    }
  }
  return {
    content,
    contentLength: text.length,
    offset: start,
    nextOffset: end < text.length ? end : null,
    truncated: start > 0 || end < text.length,
  };
}

export interface TextEdit {
  oldString: string;
  newString: string;
  replaceAll: boolean;
}

/**
 * Applies exact replacements in order, each to the result of the previous one. Each
 * `oldString` must occur exactly once unless `replaceAll`, so an edit never lands in the
 * wrong place.
 */
export function applyTextEdits(
  text: string,
  edits: readonly TextEdit[],
): { text: string; replacements: number } {
  let result = text;
  let replacements = 0;
  edits.forEach((edit, i) => {
    const count = occurrences(result, edit.oldString);
    if (count === 0) {
      throw new WikiEditError(`edits[${i}].oldString does not occur in the page text.`);
    }
    if (count > 1 && !edit.replaceAll) {
      throw new WikiEditError(
        `edits[${i}].oldString occurs ${count} times; add surrounding text to make it unique or set replaceAll.`,
      );
    }
    // split/join rather than String.replace: `$&` and friends in newString stay literal.
    if (edit.replaceAll) {
      result = result.split(edit.oldString).join(edit.newString);
    } else {
      const at = result.indexOf(edit.oldString);
      result = result.slice(0, at) + edit.newString + result.slice(at + edit.oldString.length);
    }
    replacements += edit.replaceAll ? count : 1;
  });
  return { text: result, replacements };
}

function occurrences(text: string, part: string): number {
  let count = 0;
  for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + part.length)) count++;
  return count;
}
