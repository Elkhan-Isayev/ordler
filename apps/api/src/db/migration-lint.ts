/**
 * Upgrades must never lose data (SPEC §16.5). Migrations follow expand/contract: add new
 * structures, move data, and only remove old ones in a later major release. A migration that
 * really needs a destructive statement says so explicitly with a marker and a reason:
 *
 *   -- ordler:allow-destructive <why this is safe>
 */
export const ALLOW_DESTRUCTIVE_MARKER = /--[ \t]*ordler:allow-destructive[ \t]+\S/;

const DESTRUCTIVE: Array<{ rule: string; pattern: RegExp }> = [
  { rule: 'drop', pattern: /\bDROP\s+(TABLE|COLUMN|SCHEMA|TYPE|VIEW|MATERIALIZED\s+VIEW)\b/i },
  { rule: 'truncate', pattern: /\bTRUNCATE\b/i },
  { rule: 'delete', pattern: /\bDELETE\s+FROM\b/i },
  { rule: 'rename', pattern: /\bRENAME\s+(COLUMN\s+|TO\s+)/i },
  { rule: 'retype', pattern: /\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i },
];

export interface LintFinding {
  rule: string;
  line: number;
  statement: string;
}

export function findDestructiveStatements(sql: string): LintFinding[] {
  if (ALLOW_DESTRUCTIVE_MARKER.test(sql)) return [];
  const findings: LintFinding[] = [];
  sql.split('\n').forEach((text, index) => {
    const code = text.replace(/--.*$/, '');
    for (const { rule, pattern } of DESTRUCTIVE) {
      if (pattern.test(code)) findings.push({ rule, line: index + 1, statement: text.trim() });
    }
  });
  return findings;
}
