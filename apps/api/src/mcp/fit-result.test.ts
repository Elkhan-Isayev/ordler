import { describe, expect, it } from 'vitest';
import { fitJson, safeSlice, SHORTENED_NOTE } from './fit-result.js';

describe('fitJson', () => {
  it('leaves a result that fits untouched', () => {
    const data = { id: 1, title: 'Router' };
    expect(fitJson(data, 1000)).toBe(JSON.stringify(data, null, 2));
  });

  it('shortens the longest text inside the object and stays valid JSON (issue #1)', () => {
    const content = 'line\n'.repeat(20_000);
    const text = fitJson({ id: 'p1', version: 7, content, title: 'Big' }, 10_000);
    expect(text.length).toBeLessThanOrEqual(10_000);
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({ id: 'p1', version: 7, title: 'Big' });
    expect(parsed.content).toMatch(/… \[shortened: \d+ of 100000 characters\]$/);
    expect(content.startsWith(parsed.content.replace(/… \[shortened.*$/, ''))).toBe(true);
    expect(parsed.resultShortened).toBe(SHORTENED_NOTE);
  });

  it('keeps the original length when it has to shorten the same text again', () => {
    const text = fitJson({ a: '"'.repeat(30_000), b: 'x'.repeat(30_000) }, 8000);
    const parsed = JSON.parse(text);
    expect(text.length).toBeLessThanOrEqual(8000);
    expect(parsed.a).toMatch(/of 30000 characters\]$/);
    expect(parsed.b).toMatch(/of 30000 characters\]$/);
  });

  it('drops the tail of a long list and wraps a list result to say so', () => {
    const items = Array.from({ length: 5000 }, (_, i) => ({ id: i, name: `Issue ${i}` }));
    const text = fitJson(items, 20_000);
    expect(text.length).toBeLessThanOrEqual(20_000);
    const parsed = JSON.parse(text);
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(parsed.items.length).toBeLessThan(5000);
    expect(parsed.items[0]).toEqual({ id: 0, name: 'Issue 0' });
    expect(parsed.resultShortened).toBe(SHORTENED_NOTE);
  });

  it('falls back to a note alone when nothing can be shortened', () => {
    const many = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`key${i}`, i]));
    const parsed = JSON.parse(fitJson(many, 1000));
    expect(parsed).toEqual({ resultShortened: SHORTENED_NOTE });
  });
});

describe('safeSlice', () => {
  it('does not split an emoji between its two halves', () => {
    expect(safeSlice('ab😀cd', 3)).toBe('ab');
    expect(safeSlice('ab😀cd', 4)).toBe('ab😀');
    expect(safeSlice('ab😀cd', 2, 2)).toBe('😀');
  });
});
