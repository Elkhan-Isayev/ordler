import {
  teamTopic,
  type CreateIssueInput,
  type IssueSummary,
  type TeamView,
  type UpdateIssueInput,
} from '@ordler/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { useRealtime } from '../realtime/client.js';

/** Column order: sortOrder ascending, newer issues first on ties. */
export function compareIssues(a: IssueSummary, b: IssueSummary): number {
  return a.sortOrder - b.sortOrder || b.number - a.number;
}

/** Inserts or replaces by id, ignoring updates older than what we already show. */
export function upsertIssue(list: IssueSummary[], next: IssueSummary): IssueSummary[] {
  const current = list.find((issue) => issue.id === next.id);
  if (current && current.updatedAt > next.updatedAt) return list;
  return [...list.filter((issue) => issue.id !== next.id), next].sort(compareIssues);
}

/** Applies a patch locally so the board reacts before the server answers. */
export function applyPatch(
  issue: IssueSummary,
  patch: UpdateIssueInput,
  team: TeamView,
): IssueSummary {
  const { assigneeId } = patch;
  const assignee =
    assigneeId === undefined
      ? issue.assignee
      : assigneeId === null
        ? null
        : (team.members.find((m) => m.id === assigneeId) ?? { id: assigneeId, name: '' });
  // The summary has no description, so a description edit changes nothing here.
  return {
    ...issue,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.statusId !== undefined
      ? {
          statusId: patch.statusId,
          status: team.statuses.find((s) => s.id === patch.statusId) ?? issue.status,
        }
      : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
    ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    assignee,
  };
}

export interface TeamIssues {
  team: TeamView | undefined;
  issues: IssueSummary[];
  /** Translation key of the last failure, if any. */
  error: string | undefined;
  update(issue: IssueSummary, patch: UpdateIssueInput): Promise<void>;
  create(input: Partial<CreateIssueInput> & { title: string }): Promise<IssueSummary | undefined>;
}

/**
 * A team's board state (SPEC §5.4): loaded once, kept live over the realtime channel,
 * refetched after reconnects, and updated optimistically with rollback on failure.
 */
export function useTeamIssues(key: string): TeamIssues {
  const [team, setTeam] = useState<TeamView>();
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      const [view, list] = await Promise.all([api.team(key), api.teamIssues(key)]);
      setTeam(view);
      setIssues([...list].sort(compareIssues));
      setError(undefined);
    } catch (failure) {
      setError(errorKey(failure));
    }
  }, [key]);

  useEffect(() => {
    setTeam(undefined);
    setIssues([]);
    void reload();
  }, [reload]);

  useRealtime(
    team ? teamTopic(team.id) : undefined,
    (message) => {
      if (message.type === 'issue.changed' && message.issue.teamId === team?.id) {
        setIssues((list) => upsertIssue(list, message.issue));
      }
      if (message.type === 'issue.removed' && message.teamId === team?.id) {
        setIssues((list) => list.filter((issue) => issue.id !== message.issueId));
      }
      // New statuses or labels: the board needs the fresh team.
      if (message.type === 'team.changed' && message.teamId === team?.id) void reload();
    },
    () => void reload(),
  );

  const update = useCallback(
    async (issue: IssueSummary, patch: UpdateIssueInput) => {
      if (!team) return;
      setIssues((list) =>
        list
          .map((item) => (item.id === issue.id ? applyPatch(item, patch, team) : item))
          .sort(compareIssues),
      );
      try {
        const saved = await api.updateIssue(issue.identifier, patch);
        setIssues((list) => upsertIssue(list, saved));
      } catch (failure) {
        // Roll back to what the server last told us.
        setIssues((list) =>
          upsertIssue(
            list.filter((item) => item.id !== issue.id),
            issue,
          ),
        );
        setError(errorKey(failure));
      }
    },
    [team],
  );

  const create = useCallback(
    async (input: Partial<CreateIssueInput> & { title: string }) => {
      try {
        const created = await api.createIssue(key, input);
        setIssues((list) => upsertIssue(list, created));
        return created;
      } catch (failure) {
        setError(errorKey(failure));
        return undefined;
      }
    },
    [key],
  );

  // Triage issues live on their own page until a member accepts them.
  return { team, issues: issues.filter((issue) => !issue.inTriage), error, update, create };
}
