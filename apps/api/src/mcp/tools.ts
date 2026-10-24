import {
  PRIORITIES,
  type IssueDetail,
  type IssueSummary,
  type RequestSummary,
  type RequestView,
  type TeamView,
  type TokenScope,
} from '@ordler/shared';
import { z } from 'zod';
import type { AppContext } from '../app-context.js';
import { DomainError } from '../auth/errors.js';
import { loadDirectory } from '../members/directory.js';
import { loadMe } from '../members/me.js';

/** Who is calling: always a member, through one of their tokens. */
export interface McpCaller {
  memberId: string;
  tokenName: string;
  scopes: readonly TokenScope[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  scope: TokenScope;
  input: z.ZodType;
  run(ctx: AppContext, caller: McpCaller, args: never): Promise<unknown>;
}

const MAX_ITEMS = 100;
const limitSchema = z.number().int().min(1).max(MAX_ITEMS).default(50).describe('Max items');
const identifierSchema = z.string().trim().min(3).max(40);

function link(ctx: AppContext, path: string): string {
  return `${ctx.baseUrl}${path}`;
}

export function issueBrief(ctx: AppContext, issue: IssueSummary) {
  return {
    identifier: issue.identifier,
    title: issue.title,
    team: issue.teamKey,
    status: issue.status.name,
    priority: issue.priority,
    assignees: issue.assignees.map((a) => a.name),
    labels: issue.labels.map((l) => l.name),
    dueDate: issue.dueDate,
    inTriage: issue.inTriage,
    updatedAt: issue.updatedAt,
    url: link(ctx, `/issue/${issue.identifier}`),
  };
}

export function issueFull(ctx: AppContext, issue: IssueDetail) {
  return {
    ...issueBrief(ctx, issue),
    description: issue.description,
    parent: issue.parent?.identifier ?? null,
    subIssues: issue.children.map((c) => ({
      identifier: c.identifier,
      title: c.title,
      status: c.status.name,
    })),
    createdBy: issue.createdBy?.name ?? null,
    createdAt: issue.createdAt,
    // Long threads are cut to the latest comments to keep agent context small.
    comments: issue.comments.slice(-20).map((c) => ({
      author: c.author?.name ?? null,
      body: c.body,
      createdAt: c.createdAt,
    })),
  };
}

export function requestBrief(ctx: AppContext, request: RequestSummary) {
  return {
    identifier: request.identifier,
    title: request.title,
    status: request.status,
    priority: request.priority,
    department: request.department.name,
    requestType: request.requestType.name,
    team: request.targetTeam.key,
    requester: request.requester?.name ?? null,
    updatedAt: request.updatedAt,
    url: link(ctx, `/requests/${request.identifier}`),
  };
}

/** The service already removed what the caller may not see (internal comments for requesters). */
export function requestFull(ctx: AppContext, request: RequestView) {
  return {
    ...requestBrief(ctx, request),
    description: request.description,
    form: request.fields.map((field) => ({
      label: field.label,
      value: request.formData[field.id] ?? null,
    })),
    approvals: request.approvals.map((step) => ({
      status: step.status,
      approvers: step.approvers.map((a) => a.name),
    })),
    comments: request.comments.slice(-20).map((c) => ({
      author: c.author?.name ?? null,
      body: c.body,
      internal: c.internal,
      createdAt: c.createdAt,
    })),
    linkedIssues: request.linkedIssues,
  };
}

async function myTeams(ctx: AppContext, memberId: string) {
  const me = await loadMe(ctx.db, memberId);
  return me?.departments.flatMap((d) => d.teams.map((t) => ({ ...t, department: d.name }))) ?? [];
}

/** Status by key ("done") or name ("In Progress"), as an agent would write it. */
function statusId(team: TeamView, value: string): string {
  const wanted = value.trim().toLowerCase();
  const status = team.statuses.find(
    (s) => s.id === value || s.key === wanted || s.name.toLowerCase() === wanted,
  );
  if (!status) throw new DomainError('status_not_in_workflow');
  return status.id;
}

/** Assignee by "me", id or exact name among the team's members. */
function assigneeId(team: TeamView, caller: McpCaller, value: string | null): string | null {
  if (value === null) return null;
  if (value === 'me') return caller.memberId;
  const wanted = value.trim().toLowerCase();
  const member = team.members.find((m) => m.id === value || m.name.toLowerCase() === wanted);
  if (!member) throw new DomainError('assignee_not_in_team');
  return member.id;
}

/** Label names as written by an agent; unknown names are refused. */
function labelIds(team: TeamView, names: string[]): string[] {
  return names.map((name) => {
    const label = team.labels.find((l) => l.name.toLowerCase() === name.trim().toLowerCase());
    if (!label) throw new DomainError('label_not_in_team');
    return label.id;
  });
}

/** "current", "next" or a cycle number, among the team's open cycles. */
function cycleIdOf(team: TeamView, value: string): string {
  const wanted = value.trim().toLowerCase();
  const cycle =
    wanted === 'current'
      ? team.cycles.find((c) => c.state === 'current')
      : wanted === 'next'
        ? team.cycles.find((c) => c.state === 'upcoming')
        : team.cycles.find((c) => String(c.number) === wanted);
  if (!cycle) throw new DomainError('cycle_not_in_team');
  return cycle.id;
}

function projectIdOf(team: TeamView, name: string): string {
  const wanted = name.trim().toLowerCase();
  const project = team.projects.find((p) => p.name.toLowerCase() === wanted);
  if (!project) throw new DomainError('project_not_in_team');
  return project.id;
}

function teamKeyOf(identifier: string): string {
  return identifier.split('-')[0]!.toUpperCase();
}

const tools: ToolDefinition[] = [
  {
    name: 'whoami',
    description: 'The member this token acts for, their teams and the token scopes.',
    scope: 'read',
    input: z.object({}),
    async run(ctx, caller) {
      const me = await loadMe(ctx.db, caller.memberId);
      return {
        member: me?.member,
        workspace: me?.workspace.companyName,
        teams: await myTeams(ctx, caller.memberId),
        token: { name: caller.tokenName, scopes: caller.scopes },
      };
    },
  },
  {
    name: 'list_teams',
    description: 'Teams the member belongs to, with department, workflow statuses and members.',
    scope: 'read',
    input: z.object({}),
    async run(ctx, caller) {
      const teams = await myTeams(ctx, caller.memberId);
      return Promise.all(
        teams.map(async (t) => {
          const team = await ctx.issues.team(caller.memberId, t.key);
          return {
            key: team.key,
            name: team.name,
            department: team.department.name,
            statuses: team.statuses.map((s) => s.name),
            members: team.members.map((m) => m.name),
          };
        }),
      );
    },
  },
  {
    name: 'list_members',
    description: 'Names of active members, for assigning issues or reading who did what.',
    scope: 'read',
    input: z.object({ query: z.string().max(100).optional(), limit: limitSchema }),
    async run(ctx, _caller, args: { query?: string; limit: number }) {
      const directory = await loadDirectory(ctx.db);
      const q = args.query?.toLowerCase();
      return directory.members
        .filter((m) => !q || m.name.toLowerCase().includes(q))
        .slice(0, args.limit)
        .map((m) => m.name);
    },
  },
  {
    name: 'search',
    description:
      'Search issues (titles, descriptions, comments, identifiers) and requests the member can open.',
    scope: 'read',
    input: z.object({ query: z.string().trim().min(1).max(200), limit: limitSchema }),
    async run(ctx, caller, args: { query: string; limit: number }) {
      const limit = Math.min(args.limit, 50);
      const [issues, requests] = await Promise.all([
        ctx.issues.search(caller.memberId, args.query, limit),
        ctx.requests.search(caller.memberId, args.query, limit),
      ]);
      return {
        issues: issues.map((i) => issueBrief(ctx, i)),
        requests: requests.map((r) => requestBrief(ctx, r)),
      };
    },
  },
  {
    name: 'get_issue',
    description: 'One issue with description and latest comments, e.g. HELP-142.',
    scope: 'read',
    input: z.object({ identifier: identifierSchema }),
    async run(ctx, caller, args: { identifier: string }) {
      return issueFull(ctx, await ctx.issues.get(caller.memberId, args.identifier));
    },
  },
  {
    name: 'list_my_issues',
    description: 'Open issues assigned to the member, across teams.',
    scope: 'read',
    input: z.object({ limit: limitSchema }),
    async run(ctx, caller, args: { limit: number }) {
      const issues = await ctx.issues.assignedTo(caller.memberId);
      return issues.slice(0, args.limit).map((i) => issueBrief(ctx, i));
    },
  },
  {
    name: 'list_team_issues',
    description:
      'Issues of a team by key (e.g. HELP); filter by status name, assignee name or "me", and label.',
    scope: 'read',
    input: z.object({
      team: z.string().trim().min(1).max(10),
      status: z.string().max(100).optional(),
      assignee: z.string().max(200).optional(),
      label: z.string().max(60).optional(),
      limit: limitSchema,
    }),
    async run(
      ctx,
      caller,
      args: { team: string; status?: string; assignee?: string; label?: string; limit: number },
    ) {
      const key = args.team.toUpperCase();
      const team = await ctx.issues.team(caller.memberId, key);
      const status = args.status ? statusId(team, args.status) : undefined;
      const assignee = args.assignee ? assigneeId(team, caller, args.assignee) : undefined;
      const label = args.label ? labelIds(team, [args.label])[0] : undefined;
      const issues = (await ctx.issues.list(caller.memberId, key)).filter(
        (i) =>
          (!status || i.statusId === status) &&
          (!assignee || i.assignees.some((a) => a.id === assignee)) &&
          (!label || i.labels.some((l) => l.id === label)),
      );
      return issues.slice(0, args.limit).map((i) => issueBrief(ctx, i));
    },
  },
  {
    name: 'create_issue',
    description:
      'Create an issue in a team by key. Issues in teams the member does not belong to land in that team’s Triage.',
    scope: 'issues:write',
    input: z.object({
      team: z.string().trim().min(1).max(10),
      title: z.string().trim().min(1).max(255),
      description: z.string().max(100_000).optional().describe('Markdown'),
      priority: z.enum(PRIORITIES).optional(),
      status: z.string().max(100).optional(),
      assignee: z.string().max(200).optional().describe('Member name, or "me"'),
      assignees: z
        .array(z.string().max(200))
        .max(10)
        .optional()
        .describe('Several member names, for teams that allow multiple assignees'),
      labels: z.array(z.string().max(60)).max(20).optional().describe('Label names'),
      parent: identifierSchema.optional().describe('Parent issue identifier, for a sub-issue'),
      cycle: z
        .string()
        .max(20)
        .optional()
        .describe('"current", "next", or a cycle number of the team'),
      project: z.string().max(120).optional().describe('Project name that includes the team'),
    }),
    async run(
      ctx,
      caller,
      args: {
        team: string;
        title: string;
        description?: string;
        priority?: (typeof PRIORITIES)[number];
        status?: string;
        assignee?: string;
        assignees?: string[];
        labels?: string[];
        parent?: string;
        cycle?: string;
        project?: string;
      },
    ) {
      const key = args.team.toUpperCase();
      const team = await ctx.issues.team(caller.memberId, key);
      const created = await ctx.issues.create(
        caller.memberId,
        key,
        {
          title: args.title,
          description: args.description ?? '',
          priority: args.priority ?? 'none',
          assigneeId: args.assignee ? assigneeId(team, caller, args.assignee) : null,
          ...(args.assignees
            ? { assigneeIds: args.assignees.map((name) => assigneeId(team, caller, name)!) }
            : {}),
          dueDate: null,
          labelIds: labelIds(team, args.labels ?? []),
          parentId: args.parent ? (await ctx.issues.get(caller.memberId, args.parent)).id : null,
          cycleId: args.cycle ? cycleIdOf(team, args.cycle) : null,
          projectId: args.project ? projectIdOf(team, args.project) : null,
          milestoneId: null,
          ...(args.status ? { statusId: statusId(team, args.status) } : {}),
        },
        caller.tokenName,
      );
      return issueFull(ctx, created);
    },
  },
  {
    name: 'update_issue',
    description:
      'Change an issue’s title, description, status, priority or assignee (null to unassign).',
    scope: 'issues:write',
    input: z.object({
      identifier: identifierSchema,
      title: z.string().trim().min(1).max(255).optional(),
      description: z.string().max(100_000).optional(),
      status: z.string().max(100).optional(),
      priority: z.enum(PRIORITIES).optional(),
      assignee: z.string().max(200).nullable().optional(),
      assignees: z.array(z.string().max(200)).max(10).optional().describe('Replaces all assignees'),
      labels: z.array(z.string().max(60)).max(20).optional().describe('Replaces all labels'),
    }),
    async run(
      ctx,
      caller,
      args: {
        identifier: string;
        title?: string;
        description?: string;
        status?: string;
        priority?: (typeof PRIORITIES)[number];
        assignee?: string | null;
        assignees?: string[];
        labels?: string[];
      },
    ) {
      const team = await ctx.issues.team(caller.memberId, teamKeyOf(args.identifier));
      const patch = {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.status !== undefined ? { statusId: statusId(team, args.status) } : {}),
        ...(args.priority !== undefined ? { priority: args.priority } : {}),
        ...(args.assignee !== undefined
          ? { assigneeId: assigneeId(team, caller, args.assignee) }
          : {}),
        ...(args.assignees !== undefined
          ? { assigneeIds: args.assignees.map((name) => assigneeId(team, caller, name)!) }
          : {}),
        ...(args.labels !== undefined ? { labelIds: labelIds(team, args.labels) } : {}),
      };
      if (Object.keys(patch).length === 0) throw new DomainError('validation_failed');
      return issueFull(
        ctx,
        await ctx.issues.update(caller.memberId, args.identifier, patch, caller.tokenName),
      );
    },
  },
  {
    name: 'add_comment',
    description: 'Comment on an issue (Markdown).',
    scope: 'issues:write',
    input: z.object({ identifier: identifierSchema, body: z.string().trim().min(1).max(100_000) }),
    async run(ctx, caller, args: { identifier: string; body: string }) {
      const detail = await ctx.issues.addComment(
        caller.memberId,
        args.identifier,
        args.body,
        caller.tokenName,
      );
      return issueFull(ctx, detail);
    },
  },
  {
    name: 'list_service_portals',
    description: 'Departments and the request types the member may submit.',
    scope: 'read',
    input: z.object({}),
    async run(ctx, caller) {
      return ctx.requestTypes.portals(caller.memberId);
    },
  },
  {
    name: 'get_request_type_form',
    description: 'Form fields of a request type, needed for create_request.',
    scope: 'read',
    input: z.object({ requestTypeId: z.uuid() }),
    async run(ctx, caller, args: { requestTypeId: string }) {
      const type = await ctx.requestTypes.get(caller.memberId, args.requestTypeId);
      return {
        id: type.id,
        name: type.name,
        description: type.description,
        fields: type.fields,
        allowsAddedApprovals: type.allowRequesterApprovals,
      };
    },
  },
  {
    name: 'create_request',
    description:
      'Submit a request. Pass requestTypeId and formData, or items (2–10) to send one request to several departments.',
    scope: 'requests:write',
    input: z.object({
      title: z.string().trim().min(1).max(255),
      description: z.string().max(100_000).optional(),
      priority: z.enum(PRIORITIES).optional(),
      requestTypeId: z.uuid().optional(),
      formData: z.record(z.string(), z.unknown()).optional().describe('Field id → value'),
      items: z
        .array(
          z.object({
            requestTypeId: z.uuid(),
            formData: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .min(2)
        .max(10)
        .optional(),
    }),
    async run(
      ctx,
      caller,
      args: {
        title: string;
        description?: string;
        priority?: (typeof PRIORITIES)[number];
        requestTypeId?: string;
        formData?: Record<string, unknown>;
        items?: Array<{ requestTypeId: string; formData?: Record<string, unknown> }>;
      },
    ) {
      const actor = { memberId: caller.memberId, tokenName: caller.tokenName };
      const base = {
        title: args.title,
        description: args.description ?? '',
        priority: args.priority ?? 'none',
        extraApprovals: [],
      };
      if (args.items) {
        const group = await ctx.requests.submitGroup(actor, {
          ...base,
          items: args.items.map((i) => ({
            requestTypeId: i.requestTypeId,
            formData: i.formData ?? {},
          })),
        });
        return {
          identifier: group.identifier,
          status: group.status,
          requests: group.children.map((r) => requestBrief(ctx, r)),
          url: link(ctx, `/request-groups/${group.identifier}`),
        };
      }
      if (!args.requestTypeId) throw new DomainError('validation_failed');
      const created = await ctx.requests.submit(actor, {
        ...base,
        requestTypeId: args.requestTypeId,
        formData: args.formData ?? {},
      });
      return requestFull(ctx, created);
    },
  },
  {
    name: 'get_request',
    description: 'One request with form answers, approval progress and comments, e.g. REQ-57.',
    scope: 'read',
    input: z.object({ identifier: identifierSchema }),
    async run(ctx, caller, args: { identifier: string }) {
      return requestFull(ctx, await ctx.requests.get(caller.memberId, args.identifier));
    },
  },
  {
    name: 'list_my_requests',
    description: 'Requests the member submitted.',
    scope: 'read',
    input: z.object({ limit: limitSchema }),
    async run(ctx, caller, args: { limit: number }) {
      const requests = await ctx.requests.mine(caller.memberId);
      return requests.slice(0, args.limit).map((r) => requestBrief(ctx, r));
    },
  },
  {
    name: 'list_my_approvals',
    description:
      'Approvals waiting for the member. Read-only: approving or rejecting happens only in Ordler by the signed-in member.',
    scope: 'read',
    input: z.object({ limit: limitSchema }),
    async run(ctx, caller, args: { limit: number }) {
      const pending = await ctx.requests.pendingApprovals(caller.memberId);
      return pending.slice(0, args.limit).map((p) => ({
        item: p.request?.identifier ?? p.group?.identifier,
        title: p.request?.title ?? p.group?.title,
        requester: p.request?.requester?.name ?? null,
        waitingSince: p.activatedAt,
        url: link(
          ctx,
          p.request
            ? `/requests/${p.request.identifier}`
            : `/request-groups/${p.group!.identifier}`,
        ),
      }));
    },
  },
];

export const TOOLS: ReadonlyMap<string, ToolDefinition> = new Map(tools.map((t) => [t.name, t]));
