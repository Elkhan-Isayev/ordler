import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { api, ApiError, apiRequest } from './client.js';

afterEach(() => vi.unstubAllGlobals());

describe('apiRequest', () => {
  it('sends JSON and returns the parsed body', async () => {
    const calls = mockApi({ 'POST /api/x': (body) => ({ json: { echo: body } }) });
    expect(await apiRequest('/api/x', { method: 'POST', body: { a: 1 } })).toEqual({
      echo: { a: 1 },
    });
    expect(calls).toEqual([{ method: 'POST', path: '/api/x', body: { a: 1 } }]);
  });

  it('turns error responses into ApiError with code and issues', async () => {
    mockApi({
      'POST /api/x': () => ({
        status: 400,
        json: { error: 'validation_failed', issues: [{ path: 'email', message: 'bad' }] },
      }),
    });
    const error = await apiRequest('/api/x', { method: 'POST', body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'validation_failed',
      issues: [{ path: 'email' }],
    });
  });

  it('reports network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    await expect(api.me()).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('handles 204 responses', async () => {
    mockApi({ 'POST /api/auth/sign-out': () => ({ status: 204 }) });
    await expect(api.signOut()).resolves.toBeUndefined();
  });
});
