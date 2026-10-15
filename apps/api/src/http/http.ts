import {
  BadRequestException,
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AppContext } from '../app-context.js';
import { DomainError } from '../auth/errors.js';
import { SESSION_COOKIE } from '../auth/sessions.js';
import type { AuthorizedRequest } from '../rbac/permission.guard.js';
import { parseCookies, serializeCookie } from './cookies.js';

export const APP_CONTEXT = Symbol('APP_CONTEXT');

export type OrdlerRequest = FastifyRequest & AuthorizedRequest;

/** Validates a request body against a shared Zod schema; failures become 400 responses. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new BadRequestException({
      error: 'validation_failed',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

/** Maps expected business failures to `{ error: code }` with their HTTP status. */
@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(error: DomainError, host: ArgumentsHost): void {
    void host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(error.status)
      .send({ error: error.code });
  }
}

export function sessionCookie(ctx: AppContext, token: string): string {
  return serializeCookie(SESSION_COOKIE, token, {
    secure: ctx.secureCookies,
    maxAgeSeconds: ctx.sessionTtlMs / 1000,
  });
}

/** Throws 429 when the limiter refuses the key. */
export function enforceLimit(allowed: boolean): void {
  if (!allowed) throw new DomainError('rate_limited');
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Fastify hooks shared by production and tests: resolves the session cookie into
 * `request.member` and rejects cross-site state-changing requests (CSRF defence on top of
 * SameSite=Lax cookies).
 */
export function registerRequestHooks(
  instance: {
    addHook(
      name: 'onRequest',
      hook: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
    ): unknown;
  },
  ctx: AppContext,
): void {
  const allowedOrigin = new URL(ctx.baseUrl).origin;

  instance.addHook('onRequest', async (request, reply) => {
    if (STATE_CHANGING.has(request.method)) {
      const origin = request.headers.origin;
      if (origin && origin !== allowedOrigin) {
        await reply.status(403).send({ error: 'forbidden_origin' });
        return;
      }
    }

    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (!token) return;
    const session = await ctx.sessions.resolve(token);
    if (session) {
      (request as OrdlerRequest).member = {
        id: session.memberId,
        strategyKind: session.strategyKind,
      };
    }
  });
}
