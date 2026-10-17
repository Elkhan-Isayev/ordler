import { describe, expect, it } from 'vitest';
import { positionBetween } from './position.js';

describe('positionBetween', () => {
  it.each([
    [undefined, undefined, 0],
    [undefined, 5, 4],
    [5, undefined, 6],
    [1, 2, 1.5],
    [-3, -1, -2],
  ])('between %s and %s → %s', (before, after, expected) => {
    expect(positionBetween(before, after)).toBe(expected);
  });
});
