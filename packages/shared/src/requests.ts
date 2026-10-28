import { z } from 'zod';
import type { MemberRef } from './issues.js';
import type { RequestSlaView, SlaBadge } from './sla.js';
import { PRIORITIES, type Priority } from './status.js';

// ---------------------------------------------------------------------------------------------
// Request type forms (SPEC §6.1)
// ---------------------------------------------------------------------------------------------

export const FORM_FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'select',
  'multi_select',
  'checkbox',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

// ---------------------------------------------------------------------------------------------
// Conditions (SPEC §6.1, §6.3): one field compared with a value, used for field visibility,
// approval steps and routing rules.
// ---------------------------------------------------------------------------------------------

const fieldRef = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/, 'field_id_invalid');
const optionValues = z.array(z.string().trim().min(1).max(80)).min(1).max(50);

export const CONDITION_OPS = [
  'in',
  'not_in',
  'eq',
  'gt',
  'gte',
  'lt',
  'lte',
  'checked',
  'unchecked',
  'set',
  'empty',
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const fieldConditionSchema = z.discriminatedUnion('op', [
  /** select: is one of; multi_select: includes at least one of. */
  z.object({ fieldId: fieldRef, op: z.literal('in'), values: optionValues }),
  z.object({ fieldId: fieldRef, op: z.literal('not_in'), values: optionValues }),
  z.object({ fieldId: fieldRef, op: z.enum(['eq', 'gt', 'gte', 'lt', 'lte']), value: z.number() }),
  z.object({ fieldId: fieldRef, op: z.enum(['checked', 'unchecked', 'set', 'empty']) }),
]);
export type FieldCondition = z.infer<typeof fieldConditionSchema>;

/** Which operators make sense for a field type; the editor offers exactly these. */
export function conditionOpsFor(type: FormFieldType): ConditionOp[] {
  switch (type) {
    case 'select':
    case 'multi_select':
      return ['in', 'not_in', 'set', 'empty'];
    case 'number':
      return ['eq', 'gt', 'gte', 'lt', 'lte', 'set', 'empty'];
    case 'checkbox':
      return ['checked', 'unchecked'];
    default:
      return ['set', 'empty'];
  }
}

/** The condition points at an existing field, with an operator and options that field has. */
export function conditionFits(
  condition: FieldCondition,
  fields: ReadonlyArray<Pick<FormField, 'id' | 'type' | 'options'>>,
): boolean {
  const field = fields.find((f) => f.id === condition.fieldId);
  if (!field || !conditionOpsFor(field.type).includes(condition.op)) return false;
  if (condition.op === 'in' || condition.op === 'not_in') {
    return condition.values.every((v) => field.options?.includes(v));
  }
  return true;
}

function isEmptyValue(value: FormValue | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    value === false ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function matchesCondition(condition: FieldCondition, data: RequestFormData): boolean {
  const value = data[condition.fieldId];
  switch (condition.op) {
    case 'set':
      return !isEmptyValue(value);
    case 'empty':
      return isEmptyValue(value);
    case 'checked':
      return value === true;
    case 'unchecked':
      return value !== true;
    case 'in':
    case 'not_in': {
      const chosen = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
      const hit = chosen.some((v) => condition.values.includes(v));
      return condition.op === 'in' ? hit : !hit;
    }
    default: {
      if (typeof value !== 'number') return false;
      const target = condition.value;
      if (condition.op === 'eq') return value === target;
      if (condition.op === 'gt') return value > target;
      if (condition.op === 'gte') return value >= target;
      if (condition.op === 'lt') return value < target;
      return value <= target;
    }
  }
}

export const formFieldSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/, 'field_id_invalid'),
    label: z.string().trim().min(1).max(120),
    type: z.enum(FORM_FIELD_TYPES),
    required: z.boolean().default(false),
    help: z.string().trim().max(300).optional(),
    options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    /** Shown (and validated) only when an earlier field matches. */
    visibleIf: fieldConditionSchema.optional(),
  })
  .refine(
    (field) =>
      (field.type !== 'select' && field.type !== 'multi_select') ||
      (field.options?.length ?? 0) > 0,
    { message: 'options_required', path: ['options'] },
  );
export type FormField = z.infer<typeof formFieldSchema>;

export const formFieldsSchema = z
  .array(formFieldSchema)
  .max(40)
  .refine((fields) => new Set(fields.map((f) => f.id)).size === fields.length, 'field_id_duplicate')
  // Only earlier fields, so visibility can never loop.
  .refine(
    (fields) =>
      fields.every((f, i) => !f.visibleIf || conditionFits(f.visibleIf, fields.slice(0, i))),
    'condition_invalid',
  );

export type FormValue = string | number | boolean | string[] | null;
export type RequestFormData = Record<string, FormValue>;

/**
 * Answers as conditions see them while the form is being filled: hidden fields count as empty
 * and number inputs may still hold their raw text. Mirrors validateFormData, so the browser
 * shows exactly the fields and approvals the server will apply.
 */
export function conditionAnswers(
  fields: readonly FormField[],
  values: Record<string, unknown>,
): { data: RequestFormData; visible: Set<string> } {
  const data: RequestFormData = {};
  const visible = new Set<string>();
  for (const field of fields) {
    if (field.visibleIf && !matchesCondition(field.visibleIf, data)) {
      data[field.id] = null;
      continue;
    }
    visible.add(field.id);
    const raw = values[field.id];
    data[field.id] =
      field.type === 'number' && typeof raw === 'string'
        ? raw.trim() === '' || !Number.isFinite(Number(raw))
          ? null
          : Number(raw)
        : ((raw as FormValue | undefined) ?? null);
  }
  return { data, visible };
}

export function visibleFieldIds(
  fields: readonly FormField[],
  values: Record<string, unknown>,
): Set<string> {
  return conditionAnswers(fields, values).visible;
}

/**
 * Checks submitted values against a request type's form; shared so the browser shows the
 * same errors the server enforces. Returns cleaned data (unknown keys dropped) or errors by
 * field id.
 */
export function validateFormData(
  fields: readonly FormField[],
  input: Record<string, unknown>,
): { ok: true; data: RequestFormData } | { ok: false; errors: Record<string, string> } {
  const data: RequestFormData = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    // Hidden fields are neither required nor kept, so stale answers cannot steer approvals.
    if (field.visibleIf && !matchesCondition(field.visibleIf, data)) {
      data[field.id] = field.type === 'checkbox' ? false : null;
      continue;
    }
    const raw = input[field.id];
    const empty =
      raw === undefined ||
      raw === null ||
      raw === '' ||
      (Array.isArray(raw) && raw.length === 0) ||
      (field.type === 'checkbox' && raw === false);
    if (empty) {
      if (field.required) errors[field.id] = 'required';
      else data[field.id] = field.type === 'checkbox' ? false : null;
      continue;
    }
    switch (field.type) {
      case 'text':
      case 'long_text': {
        const max = field.type === 'text' ? 500 : 20_000;
        if (typeof raw !== 'string' || raw.length > max) errors[field.id] = 'invalid';
        else data[field.id] = raw.trim();
        break;
      }
      case 'number': {
        const value = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(value)) errors[field.id] = 'invalid';
        else data[field.id] = value;
        break;
      }
      case 'date':
        if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw))
          errors[field.id] = 'invalid';
        else data[field.id] = raw;
        break;
      case 'select':
        if (typeof raw !== 'string' || !field.options?.includes(raw)) errors[field.id] = 'invalid';
        else data[field.id] = raw;
        break;
      case 'multi_select':
        if (
          !Array.isArray(raw) ||
          raw.some((v) => typeof v !== 'string' || !field.options?.includes(v))
        ) {
          errors[field.id] = 'invalid';
        } else data[field.id] = [...new Set(raw as string[])];
        break;
      case 'checkbox':
        if (typeof raw !== 'boolean') errors[field.id] = 'invalid';
        else data[field.id] = raw;
        break;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, data };
}

// ---------------------------------------------------------------------------------------------
// Approvals (SPEC §6.3)
// ---------------------------------------------------------------------------------------------

/** Who must approve a step; resolved to concrete members when the step becomes active. */
export const approverSelectorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user'), memberId: z.uuid() }),
  z.object({ type: z.literal('role'), roleId: z.uuid(), departmentId: z.uuid() }),
  z.object({ type: z.literal('department_head'), departmentId: z.uuid() }),
  z.object({ type: z.literal('requester_department_supervisor') }),
]);
export type ApproverSelector = z.infer<typeof approverSelectorSchema>;

export const APPROVAL_RULES = ['any', 'all'] as const;
export type ApprovalRule = (typeof APPROVAL_RULES)[number];

export const approvalStepInputSchema = z.object({
  selector: approverSelectorSchema,
  rule: z.enum(APPROVAL_RULES).default('any'),
});
export type ApprovalStepInput = z.infer<typeof approvalStepInputSchema>;

export const APPROVAL_TIMEOUT_ACTIONS = ['remind', 'escalate', 'reject'] as const;
export type ApprovalTimeoutAction = (typeof APPROVAL_TIMEOUT_ACTIONS)[number];

/**
 * What happens when nobody decides in time (SPEC §6.3), in business hours of the request
 * type's SLA calendar (around the clock without one). `escalate` and `reject` remind the
 * approvers halfway first.
 */
export const approvalTimeoutSchema = z.object({
  hours: z.number().min(0.25).max(2000),
  action: z.enum(APPROVAL_TIMEOUT_ACTIONS),
});
export type ApprovalTimeout = z.infer<typeof approvalTimeoutSchema>;

/** Mandatory steps of a request type may also time out and escalate; requester-added ones may not. */
export const approvalStepConfigSchema = approvalStepInputSchema.extend({
  timeout: approvalTimeoutSchema.nullable().default(null),
  /** Who decides after an escalation; the approving department's admins when empty. */
  fallbackSelector: approverSelectorSchema.nullable().default(null),
  /** The step runs only when the form matches; otherwise it is recorded as skipped. */
  condition: fieldConditionSchema.nullable().default(null),
});
export type ApprovalStepConfig = z.infer<typeof approvalStepConfigSchema>;

export const APPROVAL_DECISIONS = ['approve', 'reject', 'request_changes'] as const;
export type ApprovalDecisionKind = (typeof APPROVAL_DECISIONS)[number];

/** Reject and request changes need a comment the requester will read. */
export const approvalDecisionSchema = z
  .object({
    decision: z.enum(APPROVAL_DECISIONS),
    comment: z.string().trim().max(5000).optional(),
  })
  .refine((d) => d.decision === 'approve' || (d.comment?.length ?? 0) > 0, {
    message: 'comment_required',
    path: ['comment'],
  });
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;

export type ApprovalStepStatus =
  'waiting' | 'active' | 'approved' | 'rejected' | 'changes_requested' | 'skipped';

export interface ApprovalDecisionView {
  id: string;
  approver: MemberRef | null;
  /** Set when a delegate decided for an approver who is out of office. */
  onBehalfOf: MemberRef | null;
  decision: ApprovalDecisionKind;
  comment: string | null;
  createdAt: string;
}

/** Names a selector refers to; the UI turns them into a translated label. */
export interface SelectorNames {
  member?: string;
  role?: string;
  department?: string;
}

export interface ApprovalStepView {
  id: string;
  position: number;
  origin: 'mandatory' | 'requester_added';
  /** `group`: runs for the whole multi-department request before any child is released. */
  level: 'request' | 'group';
  selector: ApproverSelector;
  names: SelectorNames;
  rule: ApprovalRule;
  status: ApprovalStepStatus;
  approvers: MemberRef[];
  decisions: ApprovalDecisionView[];
  timeout: ApprovalTimeout | null;
  condition: FieldCondition | null;
  /** When the step went to its fallback approvers after the timeout. */
  escalatedAt: string | null;
  /** The viewer may decide this step now, themselves or as a delegate. */
  canDecide: boolean;
  /** Set when the viewer would decide as someone's delegate. */
  decidesFor: MemberRef | null;
}

// ---------------------------------------------------------------------------------------------
// Request types and portals (SPEC §6.1)
// ---------------------------------------------------------------------------------------------

const nameSchema = z.string().trim().min(1).max(120);

/** First matching rule wins; requests that match none go to the default target team. */
export const routingRuleSchema = z.object({
  condition: fieldConditionSchema,
  targetTeamId: z.uuid(),
});
export type RoutingRule = z.infer<typeof routingRuleSchema>;

export const requestTypeInputSchema = z
  .object({
    name: nameSchema,
    description: z.string().trim().max(2000).default(''),
    category: z.string().trim().max(80).nullable().default(null),
    fields: formFieldsSchema.default([]),
    targetTeamId: z.uuid(),
    routingRules: z.array(routingRuleSchema).max(20).default([]),
    approvalSteps: z.array(approvalStepConfigSchema).max(10).default([]),
    allowRequesterApprovals: z.boolean().default(false),
    /** SLA policy of the same department (SPEC §6.5). */
    slaPolicyId: z.uuid().nullable().default(null),
  })
  .refine(
    (type) =>
      type.routingRules.every((r) => conditionFits(r.condition, type.fields)) &&
      type.approvalSteps.every((s) => !s.condition || conditionFits(s.condition, type.fields)),
    { message: 'condition_invalid', path: ['fields'] },
  );
export type RequestTypeInput = z.infer<typeof requestTypeInputSchema>;

/** Where a request goes: the first rule whose condition matches, else the default team. */
export function routeRequest(
  type: { targetTeamId: string; routingRules: readonly RoutingRule[] },
  data: RequestFormData,
): string {
  return (
    type.routingRules.find((r) => matchesCondition(r.condition, data))?.targetTeamId ??
    type.targetTeamId
  );
}

export interface RequestTypeView {
  id: string;
  departmentId: string;
  departmentName: string;
  name: string;
  description: string;
  category: string | null;
  fields: FormField[];
  targetTeam: { id: string; key: string; name: string };
  routingRules: Array<RoutingRule & { team: { id: string; key: string; name: string } | null }>;
  approvalSteps: Array<ApprovalStepConfig & { names: SelectorNames }>;
  allowRequesterApprovals: boolean;
  slaPolicy: { id: string; name: string } | null;
  archivedAt: string | null;
}

/** A department's service portal: what members may request from it. */
export interface PortalView {
  department: { id: string; name: string };
  requestTypes: Array<Pick<RequestTypeView, 'id' | 'name' | 'description' | 'category'>>;
}

// ---------------------------------------------------------------------------------------------
// Requests (SPEC §6.2) and request groups (§6.4)
// ---------------------------------------------------------------------------------------------

export const REQUEST_STATUSES = [
  'pending_approval',
  'changes_requested',
  'rejected',
  'open',
  'in_progress',
  'waiting_for_requester',
  'resolved',
  'closed',
  'declined',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** No further work happens in these statuses. */
export function isFinalRequestStatus(status: RequestStatus): boolean {
  return status === 'rejected' || status === 'closed' || status === 'declined';
}

const requestBase = {
  title: z.string().trim().min(1).max(255),
  description: z.string().max(100_000).default(''),
  priority: z.enum(PRIORITIES).default('none'),
  /** Optional approvals added by the requester, if the request type allows it. */
  extraApprovals: z.array(approvalStepInputSchema).max(5).default([]),
};

export const createRequestSchema = z.object({
  ...requestBase,
  requestTypeId: z.uuid(),
  formData: z.record(z.string(), z.unknown()).default({}),
});
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

/** One request to several departments (§6.4): shared fields once, one form per type. */
export const createRequestGroupSchema = z.object({
  ...requestBase,
  items: z
    .array(
      z.object({
        requestTypeId: z.uuid(),
        formData: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(2)
    .max(10),
});
export type CreateRequestGroupInput = z.infer<typeof createRequestGroupSchema>;

/** Requester edits after "changes requested", then resubmits. */
export const resubmitRequestSchema = z.object({
  title: requestBase.title.optional(),
  description: z.string().max(100_000).optional(),
  formData: z.record(z.string(), z.unknown()).optional(),
});
export type ResubmitRequestInput = z.infer<typeof resubmitRequestSchema>;

/** Receiving team actions. */
export const requestActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), assigneeId: z.uuid().nullable().optional() }),
  z.object({ action: z.literal('decline'), reason: z.string().trim().min(1).max(2000) }),
  z.object({
    action: z.literal('wait_for_requester'),
    comment: z.string().trim().min(1).max(20_000),
  }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('resolve'), comment: z.string().trim().max(20_000).optional() }),
  z.object({ action: z.literal('assign'), assigneeId: z.uuid().nullable() }),
  z.object({ action: z.literal('priority'), priority: z.enum(PRIORITIES) }),
]);
export type RequestAction = z.infer<typeof requestActionSchema>;

/** Requester actions on their own request. */
export const requesterActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm') }),
  z.object({ action: z.literal('reopen'), comment: z.string().trim().min(1).max(20_000) }),
]);
export type RequesterAction = z.infer<typeof requesterActionSchema>;

export const requestCommentSchema = z.object({
  body: z.string().trim().min(1).max(100_000),
  internal: z.boolean().default(false),
});

export interface RequestCommentView {
  id: string;
  author: MemberRef | null;
  body: string;
  internal: boolean;
  createdAt: string;
}

export interface RequestEventView {
  id: string;
  kind: string;
  actor: MemberRef | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface RequestSummary {
  id: string;
  identifier: string;
  title: string;
  status: RequestStatus;
  priority: Priority;
  requestType: { id: string; name: string };
  department: { id: string; name: string };
  targetTeam: { id: string; key: string; name: string };
  requester: MemberRef | null;
  assignee: MemberRef | null;
  group: { id: string; identifier: string } | null;
  /** The SLA clock closest to breaching, when the type has an SLA. */
  sla: SlaBadge | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestView extends RequestSummary {
  description: string;
  fields: FormField[];
  formData: RequestFormData;
  /** `agent`: the receiving team (internal comments, linked issues); otherwise requester view. */
  perspective: 'agent' | 'requester';
  approvals: ApprovalStepView[];
  comments: RequestCommentView[];
  events: RequestEventView[];
  /** Both SLA clocks; requesters see them too, as the expected response times (SPEC §6.2). */
  slaClocks: RequestSlaView | null;
  /** Agents get identifiers and statuses; requesters only see how many are done. */
  linkedIssues:
    | { kind: 'details'; items: Array<{ identifier: string; title: string; done: boolean }> }
    | { kind: 'progress'; done: number; total: number };
  siblings: Array<Pick<RequestSummary, 'identifier' | 'title' | 'status' | 'department'>>;
  can: {
    act: boolean;
    commentPublic: boolean;
    commentInternal: boolean;
    resubmit: boolean;
    confirm: boolean;
    spawnIssue: boolean;
  };
}

export interface RequestGroupView {
  id: string;
  identifier: string;
  title: string;
  /** Derived from the children and group-level approvals (§6.4). */
  status: 'pending_approval' | 'rejected' | 'in_progress' | 'resolved';
  approvals: ApprovalStepView[];
  children: RequestSummary[];
}

/** One row of the Approvals page. */
export interface PendingApproval {
  stepId: string;
  selector: ApproverSelector;
  names: SelectorNames;
  request: Pick<RequestSummary, 'identifier' | 'title' | 'requester' | 'department'> | null;
  group: { identifier: string; title: string } | null;
  activatedAt: string;
  /** The approver this member stands in for, when it is delegated. */
  onBehalfOf: MemberRef | null;
}

/** Out of office (SPEC §6.3): someone else decides my approvals between two dates. */
export const delegationInputSchema = z
  .object({
    delegateId: z.uuid(),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
  })
  .refine((d) => d.endsOn >= d.startsOn, { message: 'end_before_start', path: ['endsOn'] });
export type DelegationInput = z.infer<typeof delegationInputSchema>;

export interface DelegationView {
  id: string;
  delegate: MemberRef;
  startsOn: string;
  endsOn: string;
  active: boolean;
}

export const REQUEST_ERROR_CODES = [
  'form_invalid',
  'approvals_not_allowed',
  'not_an_approver',
  'already_decided',
  'step_not_active',
  'delegation_overlap',
  'invalid_transition',
  'session_required',
  'request_type_archived',
] as const;
export type RequestErrorCode = (typeof REQUEST_ERROR_CODES)[number];

export function formatRequestIdentifier(number: number): string {
  return `REQ-${number}`;
}

export function formatGroupIdentifier(number: number): string {
  return `REQ-G-${number}`;
}

export function parseRequestIdentifier(value: string): number | undefined {
  const match = /^REQ-(\d+)$/i.exec(value.trim());
  return match ? Number(match[1]) : undefined;
}

export function parseGroupIdentifier(value: string): number | undefined {
  const match = /^REQ-G-(\d+)$/i.exec(value.trim());
  return match ? Number(match[1]) : undefined;
}

/** Response of GET /api/directory: who and what can be picked as an approver. */
export interface DirectoryView {
  members: MemberRef[];
  departments: Array<{ id: string; name: string }>;
  /** Roles usable in `role@department` selectors; system roles carry their key. */
  roles: Array<{ id: string; key: string | null; name: string }>;
}
