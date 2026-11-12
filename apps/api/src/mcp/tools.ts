import {
  PRIORITIES,
  WIKI_MAX_CONTENT,
  wikiWhiteboardEmbed,
  wikiWhiteboards,
  type WikiFolder,
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
import {
  buildDiagram,
  describeBoard,
  diagramEdgeSchema,
  diagramNodeSchema,
  type DiagramEdge,
  type DiagramNode,
} from '../whiteboards/diagram.js';

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

/** An issue as agents read it, with the whiteboards attached to it. */
export async function issueWithBoards(ctx: AppContext, caller: McpCaller, identifier: string) {
  const issue = issueFull(ctx, await ctx.issues.get(caller.memberId, identifier));
  const boards = await ctx.whiteboards.forIssue(caller.memberId, identifier);
  return {
    ...issue,
    whiteboards: boards.map((b) => ({
      id: b.id,
      title: b.title,
      resource: `ordler://whiteboard/${b.id}`,
      url: link(ctx, `/whiteboards/${b.id}`),
    })),
  };
}

/** A whiteboard as agents read it: what is drawn, as shapes, connectors and text. */
export async function whiteboardFull(ctx: AppContext, caller: McpCaller, id: string) {
  const board = await ctx.whiteboards.get(caller.memberId, id);
  const elements = await ctx.whiteboards.elements(caller.memberId, id);
  return {
    id: board.id,
    title: board.title,
    team: board.team.key,
    url: link(ctx, `/whiteboards/${board.id}`),
    issues: board.issues.map((i) => i.identifier),
    canEdit: board.canEdit,
    ...describeBoard(elements),
  };
}

const departmentRef = z.string().trim().min(1).max(200).describe('Department name or id');

/** A department wiki by name (case-insensitive) or id, among the spaces the member can read. */
async function wikiDepartment(ctx: AppContext, caller: McpCaller, ref: string): Promise<string> {
  const spaces = await ctx.wiki.spaces(caller.memberId);
  const found =
    spaces.find((s) => s.department.id === ref) ??
    spaces.find((s) => s.department.name.toLowerCase() === ref.toLowerCase());
  if (!found) throw new DomainError('not_found');
  return found.department.id;
}

/** Folder id → path like "Guides/Setup". */
function folderPaths(folders: readonly WikiFolder[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const paths = new Map<string, string>();
  for (const folder of folders) {
    const names: string[] = [];
    let current: WikiFolder | undefined = folder;
    while (current && names.length < 32) {
      names.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    paths.set(folder.id, names.join('/'));
  }
  return paths;
}

/** A wiki page the caller may edit through this token; refused otherwise. */
async function editableWikiPage(ctx: AppContext, caller: McpCaller, id: string) {
  if (!caller.scopes.includes('wiki:write')) throw new DomainError('forbidden');
  const page = await ctx.wiki.page(caller.memberId, id);
  if (!page.canEdit) throw new DomainError('forbidden');
  return page;
}

/** Appends a whiteboard embed as its own paragraph, unless the page already shows it. */
async function embedInWikiPage(
  ctx: AppContext,
  caller: McpCaller,
  pageId: string,
  boardId: string,
  title: string,
) {
  const page = await editableWikiPage(ctx, caller, pageId);
  if (wikiWhiteboards(page.content).includes(boardId)) return;
  const embed = wikiWhiteboardEmbed(boardId, title);
  await ctx.wiki.updatePage(
    caller.memberId,
    pageId,
    { content: page.content.trim() ? `${page.content.trimEnd()}\n\n${embed}\n` : `${embed}\n` },
    caller.tokenName,
  );
}

/** A wiki page as agents read it, with the diagrams (whiteboards) it embeds. */
export async function wikiPageFull(ctx: AppContext, caller: McpCaller, id: string) {
  const page = await ctx.wiki.page(caller.memberId, id);
  return {
    id: page.id,
    title: page.title,
    department: page.department.name,
    folder: page.path.map((f) => f.name).join('/') || null,
    version: page.version,
    content: page.content,
    updatedBy: page.updatedBy?.name ?? null,
    updatedAt: page.updatedAt,
    canEdit: page.canEdit,
    whiteboards: wikiWhiteboards(page.content).map((boardId) => ({
      id: boardId,
      resource: `ordler://whiteboard/${boardId}`,
    })),
    url: link(ctx, `/wiki/page/${page.id}`),
  };
}

const diagramInput = {
  nodes: z
    .array(diagramNodeSchema)
    .max(200)
    .default([])
    .describe('Boxes, ellipses, diamonds (decisions), sticky notes or free text'),
  edges: z.array(diagramEdgeSchema).max(400).default([]).describe('Arrows between nodes'),
  direction: z.enum(['down', 'right']).default('down'),
};

async function drawDiagram(
  ctx: AppContext,
  caller: McpCaller,
  id: string,
  diagram: { nodes: DiagramNode[]; edges: DiagramEdge[]; direction: 'down' | 'right' },
) {
  if (diagram.nodes.length === 0 && diagram.edges.length === 0) return;
  const existing = await ctx.whiteboards.elements(caller.memberId, id);
  const elements = buildDiagram(diagram, existing);
  await ctx.whiteboards.save(caller.memberId, id, { elements }, caller.tokenName);
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
      return issueWithBoards(ctx, caller, args.identifier);
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
  {
    name: 'list_whiteboards',
    description:
      'Whiteboards (collaborative diagrams) the member can see, newest first; optionally of one team.',
    scope: 'read',
    input: z.object({ team: z.string().trim().min(1).max(10).optional(), limit: limitSchema }),
    async run(ctx, caller, args: { team?: string; limit: number }) {
      const boards = await ctx.whiteboards.list(caller.memberId, args.team);
      return boards.slice(0, args.limit).map((b) => ({
        id: b.id,
        title: b.title,
        team: b.team.key,
        updatedAt: b.updatedAt,
        url: link(ctx, `/whiteboards/${b.id}`),
      }));
    },
  },
  {
    name: 'get_whiteboard',
    description:
      'What a whiteboard shows: shapes with labels and ids, arrows between them, free text and attached issues.',
    scope: 'read',
    input: z.object({ id: z.uuid() }),
    async run(ctx, caller, args: { id: string }) {
      return whiteboardFull(ctx, caller, args.id);
    },
  },
  {
    name: 'create_whiteboard',
    description:
      'Create a whiteboard in a team, optionally drawing a diagram (nodes and edges, laid out automatically), attaching it to an issue and embedding it at the end of a wiki page (needs the "wiki:write" scope). People see it live and can keep editing it in Ordler. Use this for every diagram in a wiki page.',
    scope: 'issues:write',
    input: z.object({
      team: z.string().trim().min(1).max(10),
      title: z.string().trim().min(1).max(200),
      issue: identifierSchema.optional().describe('Attach the board to this issue, e.g. HELP-142'),
      wikiPage: z.uuid().optional().describe('Embed the board at the end of this wiki page'),
      ...diagramInput,
    }),
    async run(
      ctx,
      caller,
      args: {
        team: string;
        title: string;
        issue?: string;
        wikiPage?: string;
        nodes: DiagramNode[];
        edges: DiagramEdge[];
        direction: 'down' | 'right';
      },
    ) {
      // Built first: a diagram the agent got wrong must not leave an empty board behind.
      const elements = args.nodes.length > 0 || args.edges.length > 0 ? buildDiagram(args, []) : [];
      // Checked before the board exists, so a refused embed leaves nothing behind.
      if (args.wikiPage) await editableWikiPage(ctx, caller, args.wikiPage);
      const board = await ctx.whiteboards.create(
        caller.memberId,
        { team: args.team, title: args.title, ...(args.issue ? { issue: args.issue } : {}) },
        caller.tokenName,
      );
      if (elements.length > 0) {
        await ctx.whiteboards.save(caller.memberId, board.id, { elements }, caller.tokenName);
      }
      if (args.wikiPage) await embedInWikiPage(ctx, caller, args.wikiPage, board.id, board.title);
      return whiteboardFull(ctx, caller, board.id);
    },
  },
  {
    name: 'embed_whiteboard_in_wiki',
    description:
      'Show an existing whiteboard inside a wiki page, as a live diagram at the end of the page.',
    scope: 'wiki:write',
    input: z.object({ id: z.uuid(), page: z.uuid() }),
    async run(ctx, caller, args: { id: string; page: string }) {
      const board = await ctx.whiteboards.get(caller.memberId, args.id);
      await embedInWikiPage(ctx, caller, args.page, board.id, board.title);
      return wikiPageFull(ctx, caller, args.page);
    },
  },
  {
    name: 'add_to_whiteboard',
    description:
      'Draw more nodes and edges on an existing whiteboard, to the right of what is there. Edges may connect to shape ids returned by get_whiteboard.',
    scope: 'issues:write',
    input: z.object({ id: z.uuid(), ...diagramInput }),
    async run(
      ctx,
      caller,
      args: { id: string; nodes: DiagramNode[]; edges: DiagramEdge[]; direction: 'down' | 'right' },
    ) {
      if (args.nodes.length === 0 && args.edges.length === 0) {
        throw new DomainError('validation_failed');
      }
      await drawDiagram(ctx, caller, args.id, args);
      return whiteboardFull(ctx, caller, args.id);
    },
  },
  {
    name: 'attach_whiteboard',
    description: 'Attach an existing whiteboard to an issue, so it shows on the issue page.',
    scope: 'issues:write',
    input: z.object({ id: z.uuid(), issue: identifierSchema }),
    async run(ctx, caller, args: { id: string; issue: string }) {
      await ctx.whiteboards.link(caller.memberId, args.issue, args.id, caller.tokenName);
      return issueWithBoards(ctx, caller, args.issue);
    },
  },
  {
    name: 'list_wiki_spaces',
    description:
      'Wiki spaces the member can read: one per department, with the number of pages and whether the member may edit.',
    scope: 'read',
    input: z.object({}),
    async run(ctx, caller) {
      return (await ctx.wiki.spaces(caller.memberId)).map((s) => ({
        department: s.department.name,
        departmentId: s.department.id,
        visibility: s.visibility,
        pages: s.pages,
        canEdit: s.canEdit,
      }));
    },
  },
  {
    name: 'list_wiki_pages',
    description:
      "A department's wiki tree: every page with its folder path. Use the department name or id.",
    scope: 'read',
    input: z.object({ department: departmentRef }),
    async run(ctx, caller, args: { department: string }) {
      const id = await wikiDepartment(ctx, caller, args.department);
      const tree = await ctx.wiki.tree(caller.memberId, id);
      const pathOf = folderPaths(tree.folders);
      return {
        department: tree.space.department.name,
        canEdit: tree.space.canEdit,
        folders: [...pathOf.values()].sort(),
        pages: tree.pages.map((p) => ({
          id: p.id,
          title: p.title,
          folder: p.folderId ? (pathOf.get(p.folderId) ?? null) : null,
          updatedAt: p.updatedAt,
          url: link(ctx, `/wiki/page/${p.id}`),
        })),
      };
    },
  },
  {
    name: 'search_wiki',
    description:
      'Find wiki pages whose title or text contains the words, across every readable department or one.',
    scope: 'read',
    input: z.object({
      query: z.string().trim().min(2).max(200),
      department: departmentRef.optional(),
      limit: limitSchema,
    }),
    async run(ctx, caller, args: { query: string; department?: string; limit: number }) {
      const department = args.department
        ? await wikiDepartment(ctx, caller, args.department)
        : undefined;
      const hits = await ctx.wiki.search(caller.memberId, args.query, department);
      return hits.slice(0, args.limit).map((h) => ({
        id: h.id,
        title: h.title,
        department: h.department.name,
        snippet: h.snippet,
        resource: `ordler://wiki/${h.id}`,
        url: link(ctx, `/wiki/page/${h.id}`),
      }));
    },
  },
  {
    name: 'get_wiki_page',
    description: 'A wiki page with its Markdown text, folder path and version.',
    scope: 'read',
    input: z.object({ id: z.uuid() }),
    async run(ctx, caller, args: { id: string }) {
      return wikiPageFull(ctx, caller, args.id);
    },
  },
  {
    name: 'create_wiki_page',
    description:
      'Create a Markdown page in a department wiki. `folder` is a path like "Guides/Setup"; missing folders are created. For diagrams do not write Mermaid or ASCII art: create a whiteboard with create_whiteboard and its `wikiPage` argument.',
    scope: 'wiki:write',
    input: z.object({
      department: departmentRef,
      folder: z.string().trim().max(1000).optional(),
      title: z.string().trim().min(1).max(200),
      content: z.string().max(WIKI_MAX_CONTENT).default(''),
    }),
    async run(
      ctx,
      caller,
      args: { department: string; folder?: string; title: string; content: string },
    ) {
      const department = await wikiDepartment(ctx, caller, args.department);
      const folderId = args.folder
        ? await ctx.wiki.folderAtPath(
            caller.memberId,
            department,
            args.folder,
            true,
            caller.tokenName,
          )
        : null;
      const page = await ctx.wiki.createPage(
        caller.memberId,
        { department, folderId, title: args.title, content: args.content },
        caller.tokenName,
      );
      return wikiPageFull(ctx, caller, page.id);
    },
  },
  {
    name: 'update_wiki_page',
    description:
      "Change a wiki page: title, full Markdown text, or folder path. Pass `baseVersion` from get_wiki_page to refuse overwriting someone else's newer edit.",
    scope: 'wiki:write',
    input: z.object({
      id: z.uuid(),
      title: z.string().trim().min(1).max(200).optional(),
      content: z.string().max(WIKI_MAX_CONTENT).optional(),
      folder: z.string().trim().max(1000).optional().describe('Folder path; "" for the root'),
      baseVersion: z.number().int().min(1).optional(),
    }),
    async run(
      ctx,
      caller,
      args: { id: string; title?: string; content?: string; folder?: string; baseVersion?: number },
    ) {
      const current = await ctx.wiki.page(caller.memberId, args.id);
      const folderId =
        args.folder === undefined
          ? undefined
          : await ctx.wiki.folderAtPath(
              caller.memberId,
              current.department.id,
              args.folder,
              true,
              caller.tokenName,
            );
      await ctx.wiki.updatePage(
        caller.memberId,
        args.id,
        {
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.content !== undefined ? { content: args.content } : {}),
          ...(folderId !== undefined ? { folderId } : {}),
          ...(args.baseVersion !== undefined ? { baseVersion: args.baseVersion } : {}),
        },
        caller.tokenName,
      );
      return wikiPageFull(ctx, caller, args.id);
    },
  },
];

export const TOOLS: ReadonlyMap<string, ToolDefinition> = new Map(tools.map((t) => [t.name, t]));
