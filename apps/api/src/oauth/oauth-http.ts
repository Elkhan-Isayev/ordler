import type { FastifyInstance, FastifyReply } from 'fastify';
import type { RateLimiter } from '../auth/rate-limiter.js';
import { OAuthError, type OAuthService } from './oauth.service.js';

/** Paths MCP clients call from anywhere, without cookies; the CSRF Origin check skips them. */
export const OAUTH_PUBLIC_POSTS = new Set(['/api/oauth/token', '/api/oauth/register']);

/**
 * OAuth endpoints MCP clients discover and call (MCP authorization, RFC 9728, 8414, 7591,
 * 6749). They carry no cookies, so they allow any origin; consent happens in the web app.
 */
export function registerOAuthHttp(
  instance: FastifyInstance,
  oauth: OAuthService,
  registrations: RateLimiter,
): void {
  const cors = (reply: FastifyReply) =>
    reply
      .header('access-control-allow-origin', '*')
      .header('access-control-allow-methods', 'GET, POST, OPTIONS')
      .header('access-control-allow-headers', 'content-type, authorization, mcp-protocol-version');

  void instance.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string', bodyLimit: 64 * 1024 },
      (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
    );
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: 64 * 1024 },
      (_request, body, done) => {
        try {
          done(null, JSON.parse(String(body)));
        } catch {
          done(null, undefined);
        }
      },
    );

    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      scope.get(path, async (_request, reply) =>
        cors(reply).send(oauth.protectedResourceMetadata()),
      );
    }
    scope.get('/.well-known/oauth-authorization-server', async (_request, reply) =>
      cors(reply).send(oauth.authorizationServerMetadata()),
    );
    for (const path of OAUTH_PUBLIC_POSTS) {
      scope.options(path, async (_request, reply) => cors(reply).status(204).send());
    }

    scope.post('/api/oauth/register', async (request, reply) => {
      cors(reply);
      if (!registrations.attempt(request.ip)) {
        return reply.status(429).header('retry-after', '60').send({ error: 'rate_limited' });
      }
      try {
        return reply.status(201).send(await oauth.register(request.body));
      } catch (error) {
        return oauthError(reply, error);
      }
    });

    scope.post('/api/oauth/token', async (request, reply) => {
      cors(reply).header('cache-control', 'no-store');
      const form = (request.body ?? {}) as Record<string, string | undefined>;
      try {
        return reply.send(await oauth.token(form));
      } catch (error) {
        return oauthError(reply, error);
      }
    });
  });
}

function oauthError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof OAuthError)) throw error;
  return reply.status(error.status).send({ error: error.error });
}
