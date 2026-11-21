import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';
import { DomainError } from '../auth/errors.js';

export type GithubHttp = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>;

/** What `POST /app-manifests/{code}/conversions` answers; only the fields Ordler keeps. */
export interface ManifestConversion {
  id: number;
  slug: string;
  pem: string;
  webhook_secret: string;
  client_secret?: string;
}

const TIMEOUT_MS = 10_000;

/** github.com serves its API from api.github.com; GitHub Enterprise Server from /api/v3. */
export function githubApiUrl(githubUrl: string): string {
  const url = new URL(githubUrl);
  return url.host === 'github.com' ? 'https://api.github.com' : `${url.origin}/api/v3`;
}

/**
 * The few GitHub REST calls Ordler makes (ADR 0019): manifest conversion, installation tokens and
 * one bot comment per pull request. Installation tokens are cached until shortly before expiry.
 */
export class GithubApi {
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly http: GithubHttp = (url, init) =>
      fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) }),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async convertManifest(githubUrl: string, code: string): Promise<ManifestConversion> {
    const result = await this.request<ManifestConversion>(
      githubUrl,
      'POST',
      `/app-manifests/${encodeURIComponent(code)}/conversions`,
    );
    if (!result.id || !result.pem || !result.webhook_secret) {
      throw new DomainError('github_rejected');
    }
    return result;
  }

  async createComment(
    app: AppCredentials,
    installationId: number,
    repository: string,
    number: number,
    body: string,
  ): Promise<number> {
    const token = await this.installationToken(app, installationId);
    const result = await this.request<{ id: number }>(
      app.githubUrl,
      'POST',
      `/repos/${repository}/issues/${number}/comments`,
      { body },
      token,
    );
    return result.id;
  }

  async updateComment(
    app: AppCredentials,
    installationId: number,
    repository: string,
    commentId: number,
    body: string,
  ): Promise<void> {
    const token = await this.installationToken(app, installationId);
    await this.request(
      app.githubUrl,
      'PATCH',
      `/repos/${repository}/issues/comments/${commentId}`,
      { body },
      token,
    );
  }

  /** Forgets cached tokens, e.g. after the app's key changed. */
  reset(): void {
    this.tokens.clear();
  }

  private async installationToken(app: AppCredentials, installationId: number): Promise<string> {
    const cacheKey = `${app.githubUrl}|${app.appId}|${installationId}`;
    const cached = this.tokens.get(cacheKey);
    // Tokens live an hour; renew five minutes early so a slow call never uses an expired one.
    if (cached && cached.expiresAt - 5 * 60_000 > this.now().getTime()) return cached.token;
    const result = await this.request<{ token: string; expires_at: string }>(
      app.githubUrl,
      'POST',
      `/app/installations/${installationId}/access_tokens`,
      undefined,
      await this.appJwt(app),
    );
    this.tokens.set(cacheKey, {
      token: result.token,
      expiresAt: new Date(result.expires_at).getTime(),
    });
    return result.token;
  }

  /** GitHub accepts app JWTs for at most ten minutes; issued a minute early for clock drift. */
  private async appJwt(app: AppCredentials): Promise<string> {
    const now = Math.floor(this.now().getTime() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(app.appId)
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 9 * 60)
      .sign(createPrivateKey(app.privateKey));
  }

  private async request<T>(
    githubUrl: string,
    method: string,
    path: string,
    body?: object,
    token?: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.http(`${githubApiUrl(githubUrl)}${path}`, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'Ordler',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new DomainError('github_unreachable');
    }
    if (!response.ok) throw new DomainError('github_rejected');
    return (await response.json()) as T;
  }
}

export interface AppCredentials {
  githubUrl: string;
  appId: string;
  privateKey: string;
}
