import { z } from 'zod';

/** Team keys prefix issue identifiers (HELP-142): 2–10 uppercase letters or digits, starting with a letter. */
export const teamKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Team key must be 2-10 uppercase letters or digits');

const nameSchema = z.string().trim().min(1).max(120);

export const createDepartmentSchema = z.object({
  name: nameSchema,
  headMemberId: z.uuid().optional(),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const createTeamSchema = z.object({
  departmentId: z.uuid(),
  name: nameSchema,
  key: teamKeySchema,
  isPrivate: z.boolean().default(false),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

/** Issue identifiers are `<TEAM_KEY>-<number>`. */
export function formatIssueIdentifier(teamKey: string, number: number): string {
  return `${teamKey}-${number}`;
}

export function parseIssueIdentifier(
  identifier: string,
): { teamKey: string; number: number } | undefined {
  const match = /^([A-Z][A-Z0-9]{1,9})-(\d+)$/.exec(identifier.trim());
  if (!match) return undefined;
  const number = Number(match[2]);
  return number > 0 ? { teamKey: match[1]!, number } : undefined;
}
