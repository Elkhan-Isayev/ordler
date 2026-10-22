import { describe, expect, it } from 'vitest';
import {
  createTeamSchema,
  formatIssueIdentifier,
  parseIssueIdentifier,
  teamKeySchema,
} from './schemas.js';
import { isTerminalCategory } from './status.js';

describe('teamKeySchema', () => {
  it.each(['IT', 'HELP', 'CS1', 'INFRA2026'])('accepts %s', (key) => {
    expect(teamKeySchema.safeParse(key).success).toBe(true);
  });

  it.each(['I', 'help', '1CS', 'TOOLONGKEY1', 'HE-LP'])('rejects %s', (key) => {
    expect(teamKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('createTeamSchema', () => {
  it('defaults teams to public', () => {
    const parsed = createTeamSchema.parse({
      departmentId: '0199e0a4-6c3e-7c2a-9d1b-1a2b3c4d5e6f',
      name: 'Helpdesk',
      key: 'HELP',
    });
    expect(parsed.isPrivate).toBe(false);
  });

  it('requires a department id', () => {
    expect(createTeamSchema.safeParse({ name: 'Helpdesk', key: 'HELP' }).success).toBe(false);
  });
});

describe('issue identifiers', () => {
  it('round-trips', () => {
    expect(parseIssueIdentifier(formatIssueIdentifier('HELP', 142))).toEqual({
      teamKey: 'HELP',
      number: 142,
    });
  });

  it.each(['help-1', 'HELP-0', 'HELP', 'HELP-x'])('rejects %s', (identifier) => {
    expect(parseIssueIdentifier(identifier)).toBeUndefined();
  });
});

describe('isTerminalCategory', () => {
  it('treats completed and canceled as terminal', () => {
    expect(isTerminalCategory('completed')).toBe(true);
    expect(isTerminalCategory('canceled')).toBe(true);
    expect(isTerminalCategory('pending_approval')).toBe(false);
  });
});

describe('extractMentions', () => {
  it('finds each mentioned member once', async () => {
    const { extractMentions, mentionHref } = await import('./issues.js');
    const ann = '01a13d37-d040-7000-b257-0000000000a1';
    const bob = '01a13d37-d040-7000-b257-0000000000b2';
    const text = `Hi [@Ann](${mentionHref(ann)}) and [@Bob](/people/${bob}), [@Ann](/people/${ann}). [x](/people/nope)`;
    expect(extractMentions(text)).toEqual([ann, bob]);
    expect(extractMentions('no mentions @here')).toEqual([]);
  });
});
