import type {
  ApiErrorBody,
  MeResponse,
  PublicStrategy,
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
  options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
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

export const api = {
  setupStatus: () => apiRequest<{ setupRequired: boolean }>('/api/setup/status'),
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
};

export const GOOGLE_START_URL = '/api/auth/google/start';
