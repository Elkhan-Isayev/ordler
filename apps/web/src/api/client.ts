import type {
  CreateWebhookInput,
  UpdateWebhookInput,
  WebhookDeliveryView,
  WebhookView,
  WebhookWithSecret,
  ImportConfig,
  ImportConnectInput,
  ImportDryRun,
  ImportOptions,
  ImportRunView,
  AdminDepartment,
  AdminMember,
  AdminRole,
  ApiErrorBody,
  AuditPage,
  RoleInput,
  ChatSubscriptionInput,
  CreatedToken,
  CreateTokenInput,
  PersonalTokenView,
  TokenSettings,
  ChatSubscriptionView,
  InboxCounts,
  NotificationView,
  AssignRoleInput,
  ApprovalDecisionInput,
  CreateRequestGroupInput,
  CreateRequestInput,
  DirectoryView,
  PendingApproval,
  PortalView,
  RequestAction,
  RequestGroupView,
  RequesterAction,
  RequestSummary,
  RequestTypeInput,
  RequestTypeView,
  RequestView,
  ResubmitRequestInput,
  AttachmentView,
  DatabaseProbeResult,
  DatabaseSettingsInput,
  DatabaseSettingsView,
  DatabaseUpdateResult,
  InstallDatabaseInput,
  InviteResponse,
  CreateIssueInput,
  CreateLabelInput,
  CycleDetail,
  InitiativeDetail,
  InitiativeInput,
  InitiativeSummary,
  ProjectDetail,
  ProjectHealth,
  ProjectInput,
  ProjectSummary,
  CycleSettings,
  CycleView,
  TeamCycles,
  IssueStatusCategory,
  WorkflowStatus,
  LabelView,
  IssueDetail,
  IssueSummary,
  TeamView,
  TriageAction,
  UpdateIssueInput,
  MailSettingsView,
  MeResponse,
  PublicStrategy,
  SetupStatusResponse,
  TestMailResult,
  UpdateAuthStrategyInput,
  UpdateMailSettingsInput,
  UpdateStatusResponse,
} from '@ordler/shared';

export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    readonly issues: ApiErrorBody['issues'] = [],
  ) {
    super(code);
  }
}

/** JSON over fetch with the session cookie; non-2xx responses become ApiError. */
export async function apiRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    const body = data as Partial<ApiErrorBody>;
    throw new ApiError(response.status, body.error ?? 'unknown', body.issues ?? []);
  }
  return data as T;
}

/** Multipart upload of one file; the browser sets the boundary header itself. */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const body = new FormData();
  body.append('file', file, file.name);
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', credentials: 'same-origin', body });
  } catch {
    throw new ApiError(0, 'network');
  }
  const data = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    const error = data as Partial<ApiErrorBody>;
    throw new ApiError(response.status, error.error ?? 'unknown', error.issues ?? []);
  }
  return data as T;
}

export const api = {
  setupStatus: () => apiRequest<SetupStatusResponse>('/api/setup/status'),
  testInstallDatabase: (body: InstallDatabaseInput) =>
    apiRequest<DatabaseProbeResult>('/api/install/database/test', { method: 'POST', body }),
  installDatabase: (body: InstallDatabaseInput) =>
    apiRequest<DatabaseProbeResult>('/api/install/database', { method: 'POST', body }),
  databaseSettings: () => apiRequest<DatabaseSettingsView>('/api/admin/database'),
  updateDatabaseSettings: (body: DatabaseSettingsInput) =>
    apiRequest<DatabaseUpdateResult>('/api/admin/database', { method: 'PUT', body }),
  completeSetup: (body: unknown) => apiRequest<MeResponse>('/api/setup', { method: 'POST', body }),
  me: () => apiRequest<MeResponse>('/api/me'),
  strategies: () => apiRequest<PublicStrategy[]>('/api/auth/strategies'),
  signInWithPassword: (email: string, password: string) =>
    apiRequest<MeResponse>('/api/auth/password', { method: 'POST', body: { email, password } }),
  requestOtp: (email: string) =>
    apiRequest<{ status: string }>('/api/auth/otp/request', { method: 'POST', body: { email } }),
  verifyOtp: (email: string, code: string) =>
    apiRequest<MeResponse>('/api/auth/otp/verify', { method: 'POST', body: { email, code } }),
  signOut: () => apiRequest<void>('/api/auth/sign-out', { method: 'POST' }),
  updateStatus: () => apiRequest<UpdateStatusResponse>('/api/admin/updates'),
  checkForUpdates: () =>
    apiRequest<UpdateStatusResponse>('/api/admin/updates/check', { method: 'POST' }),
  departments: () => apiRequest<AdminDepartment[]>('/api/admin/departments'),
  createDepartment: (name: string) =>
    apiRequest<{ id: string }>('/api/admin/departments', { method: 'POST', body: { name } }),
  archiveDepartment: (id: string) =>
    apiRequest<void>(`/api/admin/departments/${id}/archive`, { method: 'POST' }),
  createTeam: (departmentId: string, body: { name: string; key: string; isPrivate: boolean }) =>
    apiRequest<{ id: string }>(`/api/admin/departments/${departmentId}/teams`, {
      method: 'POST',
      body,
    }),
  updateTeam: (
    id: string,
    body: { name?: string; isPrivate?: boolean; multipleAssignees?: boolean },
  ) => apiRequest<void>(`/api/admin/teams/${id}`, { method: 'PATCH', body }),
  archiveTeam: (id: string) =>
    apiRequest<void>(`/api/admin/teams/${id}/archive`, { method: 'POST' }),
  members: () => apiRequest<AdminMember[]>('/api/admin/members'),
  roles: () => apiRequest<AdminRole[]>('/api/admin/roles'),
  inviteMember: (body: unknown) =>
    apiRequest<InviteResponse>('/api/admin/members', { method: 'POST', body }),
  reinvite: (memberId: string) =>
    apiRequest<{ inviteUrl: string; emailed: boolean }>(`/api/admin/members/${memberId}/invite`, {
      method: 'POST',
    }),
  setMemberStatus: (memberId: string, status: 'active' | 'deactivated') =>
    apiRequest<AdminMember>(`/api/admin/members/${memberId}`, {
      method: 'PATCH',
      body: { status },
    }),
  assignRole: (memberId: string, body: AssignRoleInput) =>
    apiRequest<AdminMember>(`/api/admin/members/${memberId}/roles`, { method: 'POST', body }),
  removeRole: (memberId: string, assignmentId: string) =>
    apiRequest<AdminMember>(`/api/admin/members/${memberId}/roles/${assignmentId}`, {
      method: 'DELETE',
    }),
  addToTeam: (teamId: string, memberId: string) =>
    apiRequest<AdminMember>(`/api/admin/teams/${teamId}/members/${memberId}`, { method: 'PUT' }),
  removeFromTeam: (teamId: string, memberId: string) =>
    apiRequest<AdminMember>(`/api/admin/teams/${teamId}/members/${memberId}`, {
      method: 'DELETE',
    }),
  authStrategies: () => apiRequest<AdminStrategy[]>('/api/admin/auth/strategies'),
  updateAuthStrategy: (kind: string, body: UpdateAuthStrategyInput) =>
    apiRequest<AdminStrategy>(`/api/admin/auth/strategies/${kind}`, { method: 'PATCH', body }),
  mailSettings: () => apiRequest<MailSettingsView>('/api/admin/mail'),
  updateMailSettings: (body: UpdateMailSettingsInput) =>
    apiRequest<MailSettingsView>('/api/admin/mail', { method: 'PUT', body }),
  sendTestMail: (to: string) =>
    apiRequest<TestMailResult>('/api/admin/mail/test', { method: 'POST', body: { to } }),
  team: (key: string) => apiRequest<TeamView>(`/api/teams/${encodeURIComponent(key)}`),
  teamIssues: (key: string) =>
    apiRequest<IssueSummary[]>(`/api/teams/${encodeURIComponent(key)}/issues`),
  readableTeams: () =>
    apiRequest<Array<{ id: string; key: string; name: string; department: string }>>('/api/teams'),
  projects: (teamKey?: string) =>
    apiRequest<ProjectSummary[]>(
      teamKey ? `/api/teams/${encodeURIComponent(teamKey)}/projects` : '/api/projects',
    ),
  project: (id: string) => apiRequest<ProjectDetail>(`/api/projects/${id}`),
  createProject: (body: ProjectInput) =>
    apiRequest<ProjectDetail>('/api/projects', { method: 'POST', body }),
  updateProject: (id: string, body: Partial<ProjectInput>) =>
    apiRequest<ProjectDetail>(`/api/projects/${id}`, { method: 'PATCH', body }),
  archiveProject: (id: string) => apiRequest<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  postProjectUpdate: (id: string, body: { health: ProjectHealth; body: string }) =>
    apiRequest<ProjectDetail>(`/api/projects/${id}/updates`, { method: 'POST', body }),
  addMilestone: (id: string, body: { name: string; targetDate: string | null }) =>
    apiRequest<ProjectDetail>(`/api/projects/${id}/milestones`, { method: 'POST', body }),
  removeMilestone: (id: string) =>
    apiRequest<ProjectDetail>(`/api/milestones/${id}`, { method: 'DELETE' }),
  webhooks: () => apiRequest<WebhookView[]>('/api/admin/webhooks'),
  createWebhook: (body: CreateWebhookInput) =>
    apiRequest<WebhookWithSecret>('/api/admin/webhooks', { method: 'POST', body }),
  updateWebhook: (id: string, body: UpdateWebhookInput) =>
    apiRequest<WebhookView>(`/api/admin/webhooks/${id}`, { method: 'PATCH', body }),
  deleteWebhook: (id: string) =>
    apiRequest<void>(`/api/admin/webhooks/${id}`, { method: 'DELETE' }),
  rotateWebhookSecret: (id: string) =>
    apiRequest<WebhookWithSecret>(`/api/admin/webhooks/${id}/rotate-secret`, { method: 'POST' }),
  testWebhook: (id: string) =>
    apiRequest<WebhookDeliveryView>(`/api/admin/webhooks/${id}/test`, { method: 'POST' }),
  webhookDeliveries: (id: string) =>
    apiRequest<WebhookDeliveryView[]>(`/api/admin/webhooks/${id}/deliveries`),
  redeliverWebhook: (deliveryId: string) =>
    apiRequest<WebhookDeliveryView>(`/api/admin/webhooks/deliveries/${deliveryId}/redeliver`, {
      method: 'POST',
    }),
  imports: () => apiRequest<ImportRunView[]>('/api/admin/imports'),
  importRun: (id: string) => apiRequest<ImportRunView>(`/api/admin/imports/${id}`),
  connectImport: (body: ImportConnectInput) =>
    apiRequest<ImportRunView>('/api/admin/imports', { method: 'POST', body }),
  importOptions: (id: string, containers?: string[]) =>
    apiRequest<ImportOptions>(
      `/api/admin/imports/${id}/options${containers?.length ? `?containers=${containers.map(encodeURIComponent).join(',')}` : ''}`,
    ),
  configureImport: (id: string, body: ImportConfig) =>
    apiRequest<ImportRunView>(`/api/admin/imports/${id}/config`, { method: 'PUT', body }),
  dryRunImport: (id: string) =>
    apiRequest<ImportDryRun>(`/api/admin/imports/${id}/dry-run`, { method: 'POST' }),
  importAction: (id: string, action: 'start' | 'pause' | 'cancel') =>
    apiRequest<ImportRunView>(`/api/admin/imports/${id}/${action}`, { method: 'POST' }),
  initiatives: () => apiRequest<InitiativeSummary[]>('/api/initiatives'),
  initiative: (id: string) => apiRequest<InitiativeDetail>(`/api/initiatives/${id}`),
  createInitiative: (body: InitiativeInput) =>
    apiRequest<InitiativeDetail>('/api/initiatives', { method: 'POST', body }),
  updateInitiative: (id: string, body: Partial<InitiativeInput>) =>
    apiRequest<InitiativeDetail>(`/api/initiatives/${id}`, { method: 'PATCH', body }),
  setInitiativeProjects: (id: string, projectIds: string[]) =>
    apiRequest<InitiativeDetail>(`/api/initiatives/${id}/projects`, {
      method: 'PUT',
      body: { projectIds },
    }),
  archiveInitiative: (id: string) =>
    apiRequest<void>(`/api/initiatives/${id}`, { method: 'DELETE' }),
  teamCycles: (key: string) =>
    apiRequest<TeamCycles>(`/api/teams/${encodeURIComponent(key)}/cycles`),
  updateCycleSettings: (key: string, body: CycleSettings) =>
    apiRequest<TeamCycles>(`/api/teams/${encodeURIComponent(key)}/cycle-settings`, {
      method: 'PUT',
      body,
    }),
  cycle: (id: string) => apiRequest<CycleDetail>(`/api/cycles/${id}`),
  renameCycle: (id: string, name: string | null) =>
    apiRequest<CycleView>(`/api/cycles/${id}`, { method: 'PATCH', body: { name } }),
  addStatus: (key: string, body: { name: string; category: IssueStatusCategory }) =>
    apiRequest<WorkflowStatus[]>(`/api/teams/${encodeURIComponent(key)}/statuses`, {
      method: 'POST',
      body,
    }),
  reorderStatuses: (key: string, ids: string[]) =>
    apiRequest<WorkflowStatus[]>(`/api/teams/${encodeURIComponent(key)}/statuses/order`, {
      method: 'PUT',
      body: { ids },
    }),
  updateWorkflowStatus: (id: string, body: { name?: string; isDefault?: true }) =>
    apiRequest<WorkflowStatus[]>(`/api/statuses/${id}`, { method: 'PATCH', body }),
  archiveStatus: (id: string) =>
    apiRequest<WorkflowStatus[]>(`/api/statuses/${id}`, { method: 'DELETE' }),
  updateLabel: (id: string, body: { name: string; color: string }) =>
    apiRequest<LabelView>(`/api/labels/${id}`, { method: 'PATCH', body }),
  deleteLabel: (id: string) => apiRequest<void>(`/api/labels/${id}`, { method: 'DELETE' }),
  createLabel: (body: CreateLabelInput) =>
    apiRequest<LabelView>('/api/labels', { method: 'POST', body }),
  search: (q: string) =>
    apiRequest<{ issues: IssueSummary[]; requests: RequestSummary[] }>(
      `/api/search?q=${encodeURIComponent(q)}`,
    ),
  createIssue: (key: string, body: Partial<CreateIssueInput> & { title: string }) =>
    apiRequest<IssueDetail>(`/api/teams/${encodeURIComponent(key)}/issues`, {
      method: 'POST',
      body,
    }),
  issue: (identifier: string) =>
    apiRequest<IssueDetail>(`/api/issues/${encodeURIComponent(identifier)}`),
  deleteIssue: (identifier: string) =>
    apiRequest<void>(`/api/issues/${encodeURIComponent(identifier)}`, { method: 'DELETE' }),
  updateIssue: (identifier: string, body: UpdateIssueInput) =>
    apiRequest<IssueDetail>(`/api/issues/${encodeURIComponent(identifier)}`, {
      method: 'PATCH',
      body,
    }),
  myIssues: () => apiRequest<IssueSummary[]>('/api/me/issues'),
  teamTriage: (key: string) =>
    apiRequest<IssueSummary[]>(`/api/teams/${encodeURIComponent(key)}/triage`),
  decideTriage: (identifier: string, body: TriageAction) =>
    apiRequest<IssueDetail>(`/api/issues/${encodeURIComponent(identifier)}/triage`, {
      method: 'POST',
      body,
    }),
  addComment: (identifier: string, body: string) =>
    apiRequest<IssueDetail>(`/api/issues/${encodeURIComponent(identifier)}/comments`, {
      method: 'POST',
      body: { body },
    }),
  editComment: (id: string, body: string) =>
    apiRequest<IssueDetail>(`/api/comments/${id}`, { method: 'PATCH', body: { body } }),
  deleteComment: (id: string) =>
    apiRequest<IssueDetail>(`/api/comments/${id}`, { method: 'DELETE' }),
  uploadAttachment: (teamKey: string, file: File) =>
    uploadFile<AttachmentView>(`/api/teams/${encodeURIComponent(teamKey)}/attachments`, file),
  directory: () => apiRequest<DirectoryView>('/api/directory'),
  portals: () => apiRequest<PortalView[]>('/api/portals'),
  requestType: (id: string) => apiRequest<RequestTypeView>(`/api/request-types/${id}`),
  departmentRequestTypes: (departmentId: string) =>
    apiRequest<RequestTypeView[]>(`/api/admin/departments/${departmentId}/request-types`),
  createRequestType: (departmentId: string, body: RequestTypeInput) =>
    apiRequest<RequestTypeView>(`/api/admin/departments/${departmentId}/request-types`, {
      method: 'POST',
      body,
    }),
  updateRequestType: (id: string, body: RequestTypeInput) =>
    apiRequest<RequestTypeView>(`/api/admin/request-types/${id}`, { method: 'PUT', body }),
  archiveRequestType: (id: string) =>
    apiRequest<void>(`/api/admin/request-types/${id}/archive`, { method: 'POST' }),
  updateDepartment: (id: string, body: { name?: string; headMemberId?: string | null }) =>
    apiRequest<void>(`/api/admin/departments/${id}`, { method: 'PATCH', body }),
  submitRequest: (body: CreateRequestInput) =>
    apiRequest<RequestView>('/api/requests', { method: 'POST', body }),
  submitRequestGroup: (body: CreateRequestGroupInput) =>
    apiRequest<RequestGroupView>('/api/request-groups', { method: 'POST', body }),
  request: (identifier: string) =>
    apiRequest<RequestView>(`/api/requests/${encodeURIComponent(identifier)}`),
  requestGroup: (identifier: string) =>
    apiRequest<RequestGroupView>(`/api/request-groups/${encodeURIComponent(identifier)}`),
  notifications: () => apiRequest<NotificationView[]>('/api/me/notifications'),
  inboxCounts: () => apiRequest<InboxCounts>('/api/me/counts'),
  markNotifications: (body: { ids?: string[]; read: boolean }) =>
    apiRequest<InboxCounts>('/api/me/notifications/mark', { method: 'POST', body }),
  slackSubscriptions: () => apiRequest<ChatSubscriptionView[]>('/api/integrations/slack'),
  createSlackSubscription: (body: ChatSubscriptionInput) =>
    apiRequest<ChatSubscriptionView>('/api/integrations/slack', { method: 'POST', body }),
  deleteSlackSubscription: (id: string) =>
    apiRequest<void>(`/api/integrations/slack/${id}`, { method: 'DELETE' }),
  testSlackSubscription: (id: string) =>
    apiRequest<{ sent: boolean; status: number }>(`/api/integrations/slack/${id}/test`, {
      method: 'POST',
    }),
  myTokens: () =>
    apiRequest<{ tokens: PersonalTokenView[]; settings: TokenSettings }>('/api/me/tokens'),
  createToken: (body: CreateTokenInput) =>
    apiRequest<CreatedToken>('/api/me/tokens', { method: 'POST', body }),
  revokeToken: (id: string) => apiRequest<void>(`/api/me/tokens/${id}`, { method: 'DELETE' }),
  allTokens: () =>
    apiRequest<{ tokens: PersonalTokenView[]; settings: TokenSettings }>('/api/admin/tokens'),
  updateTokenSettings: (body: TokenSettings) =>
    apiRequest<TokenSettings>('/api/admin/tokens/settings', { method: 'PUT', body }),
  adminRevokeToken: (id: string) =>
    apiRequest<void>(`/api/admin/tokens/${id}`, { method: 'DELETE' }),
  createRole: (body: RoleInput) =>
    apiRequest<AdminRole>('/api/admin/roles', { method: 'POST', body }),
  updateRole: (id: string, body: RoleInput) =>
    apiRequest<AdminRole>(`/api/admin/roles/${id}`, { method: 'PUT', body }),
  deleteRole: (id: string) => apiRequest<void>(`/api/admin/roles/${id}`, { method: 'DELETE' }),
  audit: (filters: Record<string, string | undefined>) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
    ).toString();
    return apiRequest<AuditPage>(`/api/admin/audit${query ? `?${query}` : ''}`);
  },
  myRequests: () => apiRequest<RequestSummary[]>('/api/me/requests'),
  myApprovals: () => apiRequest<PendingApproval[]>('/api/me/approvals'),
  teamRequests: (key: string) =>
    apiRequest<RequestSummary[]>(`/api/teams/${encodeURIComponent(key)}/requests`),
  departmentRequests: (id: string) =>
    apiRequest<RequestSummary[]>(`/api/departments/${id}/requests`),
  requestAction: (identifier: string, body: RequestAction) =>
    apiRequest<RequestView>(`/api/requests/${encodeURIComponent(identifier)}/actions`, {
      method: 'POST',
      body,
    }),
  requesterAction: (identifier: string, body: RequesterAction) =>
    apiRequest<RequestView>(`/api/requests/${encodeURIComponent(identifier)}/requester-actions`, {
      method: 'POST',
      body,
    }),
  resubmitRequest: (identifier: string, body: ResubmitRequestInput) =>
    apiRequest<RequestView>(`/api/requests/${encodeURIComponent(identifier)}/resubmit`, {
      method: 'POST',
      body,
    }),
  commentRequest: (identifier: string, body: { body: string; internal: boolean }) =>
    apiRequest<RequestView>(`/api/requests/${encodeURIComponent(identifier)}/comments`, {
      method: 'POST',
      body,
    }),
  spawnRequestIssue: (identifier: string, title?: string) =>
    apiRequest<RequestView>(`/api/requests/${encodeURIComponent(identifier)}/issues`, {
      method: 'POST',
      body: title ? { title } : {},
    }),
  decideApproval: (stepId: string, body: ApprovalDecisionInput) =>
    apiRequest<{ request?: RequestView; group?: RequestGroupView }>(
      `/api/approvals/${stepId}/decision`,
      { method: 'POST', body },
    ),
  peekInvite: (token: string) =>
    apiRequest<{ email: string; companyName: string }>(`/api/invites/${encodeURIComponent(token)}`),
  acceptInvite: (body: { token: string; name: string; password: string }) =>
    apiRequest<MeResponse>('/api/invites/accept', { method: 'POST', body }),
};

export const GOOGLE_START_URL = '/api/auth/google/start';

/** Admin view of a sign-in strategy; secrets are never included, only whether one is set. */
export interface AdminStrategy {
  kind: 'local' | 'email_otp' | 'google';
  enabled: boolean;
  usable: boolean;
  position: number;
  displayName: string | null;
  allowSelfRegistration: boolean;
  allowedDomains: string[];
  defaultRoleId: string | null;
  config: { clientId?: string; hostedDomain?: string | null };
  hasClientSecret: boolean;
  callbackUrl: string | null;
}
