import { describe, expect, it } from 'vitest';
import {
  findIssueIdentifiers,
  issueBranchName,
  MAX_LINKED_ISSUES,
  updateGithubAppSchema,
  updateTeamGithubSchema,
} from './github.js';

describe('findIssueIdentifiers', () => {
  it('finds identifiers in branch names in any case', () => {
    expect(findIssueIdentifiers('elkhan/eng-12-fix-login')).toEqual(['ENG-12']);
    expect(findIssueIdentifiers('feature/ENG-7')).toEqual(['ENG-7']);
    expect(findIssueIdentifiers('fix-eng-3')).toEqual(['ENG-3']);
  });

  it('finds every mention in titles, bodies and messages, once, in order', () => {
    expect(findIssueIdentifiers('Fix ENG-12', 'Also OPS-3 and ENG-12.\nRef (SEC-1)')).toEqual([
      'ENG-12',
      'OPS-3',
      'SEC-1',
    ]);
  });

  it('ignores parts of longer words and numbers', () => {
    expect(findIssueIdentifiers('XENG12-3')).toEqual(['XENG12-3']);
    expect(findIssueIdentifiers('9ENG-1', 'ENG-12345678901')).toEqual([]);
    expect(findIssueIdentifiers('ENG-0', 'E-1', 'v1.2-3')).toEqual([]);
    expect(findIssueIdentifiers(null, undefined, '')).toEqual([]);
  });

  it('caps the number of linked issues', () => {
    const text = Array.from({ length: 30 }, (_, i) => `ENG-${i + 1}`).join(' ');
    expect(findIssueIdentifiers(text)).toHaveLength(MAX_LINKED_ISSUES);
  });
});

describe('issueBranchName', () => {
  it('builds <handle>/<identifier>-<short-title>', () => {
    expect(issueBranchName('elkhan@acme.test', 'ENG-12', 'Fix the login page!')).toBe(
      'elkhan/eng-12-fix-the-login-page',
    );
  });

  it('keeps names short and ASCII', () => {
    const name = issueBranchName('a.b+c@x.test', 'ENG-1', 'Ünïcode café '.repeat(10));
    expect(name.startsWith('a-b-c/eng-1-unicode-cafe')).toBe(true);
    expect(name.split('/')[1]!.length).toBeLessThanOrEqual(60);
    expect(name.endsWith('-')).toBe(false);
  });

  it('falls back to the identifier when the title has no Latin letters', () => {
    expect(issueBranchName('dev@x.test', 'OPS-3', 'Починить вход')).toBe('dev/ops-3');
  });
});

describe('GitHub schemas', () => {
  it('normalizes the GitHub URL and accepts PEM keys only', () => {
    const parsed = updateGithubAppSchema.parse({
      enabled: true,
      githubUrl: 'https://ghe.example.test/',
      privateKey: '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
    });
    expect(parsed.githubUrl).toBe('https://ghe.example.test');
    expect(
      updateGithubAppSchema.safeParse({
        enabled: true,
        githubUrl: 'https://github.com',
        privateKey: 'not a key',
      }).success,
    ).toBe(false);
    expect(
      updateGithubAppSchema.safeParse({ enabled: false, githubUrl: 'ftp://github.com' }).success,
    ).toBe(false);
  });

  it('accepts null to turn automation off', () => {
    expect(updateTeamGithubSchema.parse({ openedStatusId: null, mergedStatusId: null })).toEqual({
      openedStatusId: null,
      mergedStatusId: null,
    });
  });
});
