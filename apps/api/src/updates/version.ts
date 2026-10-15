export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | undefined;
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Accepts `1.2.3`, `v1.2.3`, `1.2.3-rc.1`; build metadata is ignored. */
export function parseSemver(value: string | undefined | null): SemVer | undefined {
  const match = SEMVER.exec((value ?? '').trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  };
}

/** Negative when a < b, positive when a > b, zero when equal (SemVer 2.0 precedence). */
export function compareSemver(a: SemVer, b: SemVer): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.prerelease === b.prerelease) return 0;
  // A release ranks above any of its pre-releases.
  if (a.prerelease === undefined) return 1;
  if (b.prerelease === undefined) return -1;
  const left = a.prerelease.split('.');
  const right = b.prerelease.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x) ? Number(x) : undefined;
    const yn = /^\d+$/.test(y) ? Number(y) : undefined;
    if (xn !== undefined && yn !== undefined && xn !== yn) return xn - yn;
    if (xn !== undefined && yn === undefined) return -1;
    if (xn === undefined && yn !== undefined) return 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function formatSemver(version: SemVer): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  return version.prerelease ? `${core}-${version.prerelease}` : core;
}

/** Major bumps may carry breaking config or upgrade-path changes (SPEC §17). */
export function isMajorUpgrade(from: SemVer, to: SemVer): boolean {
  return to.major > from.major;
}
