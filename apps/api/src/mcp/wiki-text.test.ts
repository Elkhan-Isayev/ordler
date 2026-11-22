import { describe, expect, it } from 'vitest';
import { applyTextEdits, textWindow, WikiEditError } from './wiki-text.js';

describe('textWindow', () => {
  it('returns a short text whole', () => {
    expect(textWindow('Hello', 0, 1000)).toEqual({
      content: 'Hello',
      contentLength: 5,
      offset: 0,
      nextOffset: null,
      truncated: false,
    });
  });

  it('reads a long text in parts that join back exactly', () => {
    const text = Array.from({ length: 3000 }, (_, i) => `Line ${i} — ${'x'.repeat(i % 50)}`).join(
      '\n',
    );
    const parts: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const part = textWindow(text, offset, 5000);
      expect(part.content.length).toBeLessThanOrEqual(5000);
      expect(part.truncated).toBe(true);
      parts.push(part.content);
      offset = part.nextOffset;
    }
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe(text);
    // Every part but the last ends on a whole line.
    expect(parts.slice(0, -1).every((p) => p.endsWith('\n'))).toBe(true);
  });

  it('cuts mid-line when no line break is near', () => {
    const part = textWindow('a'.repeat(3000), 0, 1000);
    expect(part).toMatchObject({ contentLength: 3000, nextOffset: 1000, truncated: true });
  });

  it('returns nothing past the end', () => {
    expect(textWindow('abc', 10, 1000)).toMatchObject({
      content: '',
      offset: 3,
      nextOffset: null,
      truncated: true,
    });
  });
});

describe('applyTextEdits', () => {
  const edit = (oldString: string, newString: string, replaceAll = false) => ({
    oldString,
    newString,
    replaceAll,
  });

  it('replaces a unique fragment and applies edits in order', () => {
    const result = applyTextEdits('Wait 10 seconds. Then plug in.', [
      edit('10 seconds', '30 seconds'),
      edit('30 seconds.', '30 seconds, then check the light.'),
    ]);
    expect(result).toEqual({
      text: 'Wait 30 seconds, then check the light. Then plug in.',
      replacements: 2,
    });
  });

  it('refuses a fragment that is missing or ambiguous', () => {
    expect(() => applyTextEdits('a b a', [edit('c', 'd')])).toThrow(WikiEditError);
    expect(() => applyTextEdits('a b a', [edit('a', 'd')])).toThrow(/occurs 2 times/);
  });

  it('replaces every occurrence with replaceAll', () => {
    expect(applyTextEdits('a b a', [edit('a', 'c', true)])).toEqual({
      text: 'c b c',
      replacements: 2,
    });
  });

  it('keeps dollar signs in the new text literal', () => {
    expect(applyTextEdits('price', [edit('price', '$& and $1')]).text).toBe('$& and $1');
  });
});
