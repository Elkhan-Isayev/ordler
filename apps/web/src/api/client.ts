import type {
  AdminDepartment,
  AdminMember,
  AdminRole,
  ApiErrorBody,
  AssignRoleInput,
  AttachmentView,
  DatabaseProbeResult,
  DatabaseSettingsInput,
  DatabaseSettingsView,
  DatabaseUpdateResult,
  InstallDatabaseInput,
  InviteResponse,
  CreateIssueInput,
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
  createIssue: (key: string, body: Partial<CreateIssueInput> & { title: string }) =>
    apiRequest<IssueDetail>(`/api/teams/${encodeURIComponent(key)}/issues`, {
      method: 'POST',
      body,
    }),
  issue: (identifier: string) =>
    apiRequest<IssueDetail>(`/api/issues/${encodeURIComponent(identifier)}`),
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
