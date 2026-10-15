import { describe, expect, it } from 'vitest';
import {
  compareSemver,
  formatSemver,
  isMajorUpgrade,
  parseSemver,
  type SemVer,
} from './version.js';

const v = (value: string): SemVer => parseSemver(value)!;

describe('parseSemver', () => {
  it('parses plain, prefixed and pre-release versions', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: undefined });
    expect(parseSemver('v10.0.1')).toMatchObject({ major: 10, minor: 0, patch: 1 });
    expect(parseSemver('2.0.0-rc.1+build.5')).toMatchObject({ prerelease: 'rc.1' });
  });

  it.each(['', '1.2', 'latest', '1.2.3.4', undefined, null])('rejects %j', (value) => {
    expect(parseSemver(value)).toBeUndefined();
  });
});

describe('compareSemver', () => {
  it.each([
    ['1.0.0', '2.0.0'],
    ['1.9.0', '1.10.0'],
    ['1.0.9', '1.0.10'],
    ['1.0.0-rc.1', '1.0.0'],
    ['1.0.0-alpha', '1.0.0-alpha.1'],
    ['1.0.0-alpha.1', '1.0.0-beta'],
    ['1.0.0-rc.2', '1.0.0-rc.10'],
    ['1.0.0-1', '1.0.0-alpha'],
  ])('%s < %s', (lower, higher) => {
    expect(compareSemver(v(lower), v(higher))).toBeLessThan(0);
    expect(compareSemver(v(higher), v(lower))).toBeGreaterThan(0);
  });

  it('treats build metadata and the v prefix as equal', () => {
    expect(compareSemver(v('v1.2.3+abc'), v('1.2.3'))).toBe(0);
  });
});

describe('helpers', () => {
  it('formats versions', () => {
    expect(formatSemver(v('v1.2.3-rc.1'))).toBe('1.2.3-rc.1');
  });

  it('detects major upgrades', () => {
    expect(isMajorUpgrade(v('1.9.0'), v('2.0.0'))).toBe(true);
    expect(isMajorUpgrade(v('1.9.0'), v('1.10.0'))).toBe(false);
  });
});
