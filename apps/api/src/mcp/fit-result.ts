/** Told to the agent when a result had to be shortened to fit. */
export const SHORTENED_NOTE =
  'Result too long and shortened to fit: long texts end with "[shortened …]" and long lists ' +
  'lost their last items. Narrow the query, lower "limit" or read a wiki page in parts with ' +
  '"offset".';

/** Strings shorter than this are left alone: shortening them saves little and hides a lot. */
const MIN_STRING = 500;
/** Room for the `resultShortened` note added to a shortened result. */
const NOTE_ROOM = SHORTENED_NOTE.length + 100;
const MARKER = /… \[shortened: \d+ of (\d+) characters\]$/;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Slot = { parent: Json[] | { [key: string]: Json }; key: string | number };

/**
 * Serialises a tool result within `maxChars` and always as valid JSON (issue #1): instead of
 * cutting the text mid-value, it shortens the longest strings, then the longest lists, and
 * says so in `resultShortened`.
 */
export function fitJson(data: unknown, maxChars: number): string {
  const text = JSON.stringify(data, null, 2) ?? 'null';
  if (text.length <= maxChars) return text;
  // A plain copy: Dates and the like become what JSON makes of them anyway.
  const root = { value: JSON.parse(text) as Json };
  const budget = Math.max(0, maxChars - NOTE_ROOM);
  const size = () => JSON.stringify(root.value, null, 2).length;

  for (let round = 0; round < 200; round++) {
    const excess = size() - budget;
    if (excess <= 0) break;
    const longest = longestString(root);
    if (!longest) break;
    const value = longest.parent[longest.key as never] as string;
    const original = Number(MARKER.exec(value)?.[1] ?? value.length);
    const body = value.replace(MARKER, '');
    // Escapes make the JSON longer than the string, so cut in proportion to the escaped size.
    const escaped = JSON.stringify(body).length;
    const cut = Math.ceil((excess * body.length) / escaped) + 100;
    const keep = Math.max(MIN_STRING, body.length - cut);
    const kept = safeSlice(body, keep);
    (longest.parent as Record<string | number, Json>)[longest.key] =
      `${kept}… [shortened: ${kept.length} of ${original} characters]`;
  }

  for (let round = 0; round < 200 && size() > budget; round++) {
    const list = longestList(root);
    if (!list) break;
    list.length = Math.floor(list.length / 2);
  }

  const note = { resultShortened: SHORTENED_NOTE };
  const shortened = Array.isArray(root.value)
    ? { items: root.value, ...note }
    : root.value !== null && typeof root.value === 'object'
      ? { ...root.value, ...note }
      : { value: root.value, ...note };
  const result = JSON.stringify(shortened, null, 2);
  // Many small fields and nothing left to shorten: say so rather than send a broken text.
  return result.length <= maxChars ? result : JSON.stringify(note, null, 2);
}

/** Cuts at most `length` characters without splitting a surrogate pair. */
export function safeSlice(text: string, length: number, from = 0): string {
  let end = Math.min(text.length, from + length);
  if (end < text.length && end > from && isHighSurrogate(text.charCodeAt(end - 1))) end--;
  return text.slice(from, end);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function longestString(root: { value: Json }): Slot | null {
  let best = null as Slot | null;
  let bestLength = MIN_STRING;
  walk(root as unknown as { [key: string]: Json }, (parent, key, value) => {
    if (typeof value !== 'string') return;
    const length = value.replace(MARKER, '').length;
    if (length > bestLength) {
      best = { parent, key };
      bestLength = length;
    }
  });
  return best;
}

function longestList(root: { value: Json }): Json[] | null {
  let best = null as Json[] | null;
  let bestSize = 0;
  walk(root as unknown as { [key: string]: Json }, (_parent, _key, value) => {
    if (!Array.isArray(value) || value.length === 0) return;
    const size = JSON.stringify(value).length;
    if (size > bestSize) {
      best = value;
      bestSize = size;
    }
  });
  return best;
}

function walk(
  node: Json[] | { [key: string]: Json },
  visit: (parent: Json[] | { [key: string]: Json }, key: string | number, value: Json) => void,
): void {
  const entries: Array<[string | number, Json]> = Array.isArray(node)
    ? node.map((v, i) => [i, v])
    : Object.entries(node);
  for (const [key, value] of entries) {
    visit(node, key, value);
    if (value !== null && typeof value === 'object') walk(value, visit);
  }
}
