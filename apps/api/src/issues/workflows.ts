import { DEFAULT_TEAM_STATUSES, type WorkflowStatus } from '@ordler/shared';
import { and, asc, eq, isNull, notInArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { teams, workflows, workflowStatuses } from '../db/schema.js';

/** Gives a team its workflow with the default statuses unless it already has one (SPEC §5.2). */
export async function ensureTeamWorkflow(db: Db, teamId: string): Promise<string> {
  const [existing] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.ownerType, 'team'), eq(workflows.ownerId, teamId)));
  if (existing) return existing.id;

  const [created] = await db
    .insert(workflows)
    .values({ ownerType: 'team', ownerId: teamId })
    // Two replicas may start at once; the unique owner index keeps one workflow.
    .onConflictDoNothing()
    .returning({ id: workflows.id });
  if (!created) return ensureTeamWorkflow(db, teamId);

  await db.insert(workflowStatuses).values(
    DEFAULT_TEAM_STATUSES.map((status, position) => ({
      workflowId: created.id,
      key: status.key,
      name: status.name,
      category: status.category,
      position,
      isDefault: 'isDefault' in status && status.isDefault,
    })),
  );
  return created.id;
}

/** Teams created before workflows existed get theirs on startup. */
export async function ensureAllTeamWorkflows(db: Db): Promise<void> {
  const owned = db
    .select({ ownerId: workflows.ownerId })
    .from(workflows)
    .where(eq(workflows.ownerType, 'team'));
  const missing = await db.select({ id: teams.id }).from(teams).where(notInArray(teams.id, owned));
  for (const team of missing) await ensureTeamWorkflow(db, team.id);
}

export async function teamStatuses(db: Db, teamId: string): Promise<WorkflowStatus[]> {
  const workflowId = await ensureTeamWorkflow(db, teamId);
  const rows = await db
    .select()
    .from(workflowStatuses)
    .where(and(eq(workflowStatuses.workflowId, workflowId), isNull(workflowStatuses.archivedAt)))
    .orderBy(asc(workflowStatuses.position));
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    category: row.category,
    position: row.position,
    isDefault: row.isDefault,
  }));
}
