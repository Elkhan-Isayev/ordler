import { createHash } from 'node:crypto';
import {
  createIssueSchema,
  createRequestSchema,
  requestCommentSchema,
  updateIssueSchema,
  type TokenScope,
} from '@ordler/shared';
import { and, eq, lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app-context.js';
import { DomainError } from '../auth/errors.js';
import { apiIdempotencyKeys } from '../db/schema.js';
import { loadMe } from '../members/me.js';

export const API_V1 = '/api/v1';
const IDEMPOTENCY_TTL_MS = 24 * 3600_000;

/** Who is calling: always a member, through one of their personal tokens (SPEC §10.1). */
export interface ApiCaller {
  memberId: string;
  tokenId: string;
  tokenName: string;
  scopes: readonly TokenScope[];
}

interface RouteInput {
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: unknown;
}

export interface ApiRoute {
  method: 'GET' | 'POST' | 'PATCH';
  /** Fastify path under /api/v1, e.g. `/issues/:identifier`. */
  path: string;
  scope: TokenScope;
  summary: string;
  body?: z.ZodType;
  /** Query parameters, documented in OpenAPI. */
  query?: Record<string, string>;
  paginated?: boolean;
  created?: boolean;
  run(ctx: AppContext, caller: ApiCaller, input: RouteInput): Promise<unknown>;
}

const commentSchema = z.object({ body: z.string().trim().min(1).max(100_000) });
const PAGE_QUERY = {
  cursor: 'Opaque cursor from the previous page',
  limit: 'Items per page, 1–100 (default 50)',
};

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw new ApiFailure(400, {
      error: 'validation_failed',
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: object,
  ) {
    super(String(status));
  }
}

/**
 * Cursor pagination over items with `id` and `createdAt`: stable oldest-first order, and the
 * cursor is the last item seen, so pages do not shift when new items arrive.
 */
export function paginate<T extends { id: string; createdAt: string }>(
  items: T[],
  query: Record<string, string | undefined>,
): { data: T[]; nextCursor: string | null } {
  const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100);
  const sorted = [...items].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  let start = 0;
  if (query.cursor) {
    let after: { c: string; i: string };
    try {
      after = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as typeof after;
    } catch {
      throw new ApiFailure(400, { error: 'invalid_cursor' });
    }
    start = sorted.findIndex(
      (item) => item.createdAt > after.c || (item.createdAt === after.c && item.id > after.i),
    );
    if (start < 0) start = sorted.length;
  }
  const data = sorted.slice(start, start + limit);
  const last = data.at(-1);
  const more = start + limit < sorted.length;
  return {
    data,
    nextCursor:
      more && last
        ? Buffer.from(JSON.stringify({ c: last.createdAt, i: last.id })).toString('base64url')
        : null,
  };
}

const since = (query: Record<string, string | undefined>) => {
  if (!query.updated_since) return undefined;
  const date = new Date(query.updated_since);
  if (Number.isNaN(date.getTime())) throw new ApiFailure(400, { error: 'validation_failed' });
  return date.toISOString();
};

/** Every route of v1; the OpenAPI document is generated from this table. */
export const ROUTES: ApiRoute[] = [
  {
    method: 'GET',
    path: '/me',
    scope: 'read',
    summary: 'The member this token acts for',
    async run(ctx, caller) {
      const me = await loadMe(ctx.db, caller.memberId);
      return { ...me, token: { name: caller.tokenName, scopes: caller.scopes } };
    },
  },
  {
    method: 'GET',
    path: '/teams',
    scope: 'read',
    summary: 'Teams the member can read',
    run: (ctx, caller) => ctx.issues.readableTeams(caller.memberId),
  },
  {
    method: 'GET',
    path: '/teams/:key',
    scope: 'read',
    summary: 'A team with its statuses, labels, members and cycles',
    run: (ctx, caller, { params }) => ctx.issues.team(caller.memberId, params.key!),
  },
  {
    method: 'GET',
    path: '/teams/:key/issues',
    scope: 'read',
    summary: 'Issues of a team, oldest first',
    query: { ...PAGE_QUERY, updated_since: 'Only issues updated at or after this ISO time' },
    paginated: true,
    async run(ctx, caller, { params, query }) {
      const after = since(query);
      const issues = await ctx.issues.list(caller.memberId, params.key!);
      return paginate(after ? issues.filter((i) => i.updatedAt >= after) : issues, query);
    },
  },
  {
    method: 'POST',
    path: '/teams/:key/issues',
    scope: 'issues:write',
    summary: 'Create an issue',
    body: createIssueSchema,
    created: true,
    run: (ctx, caller, { params, body }) =>
      ctx.issues.create(
        caller.memberId,
        params.key!,
        parse(createIssueSchema, body),
        caller.tokenName,
      ),
  },
  {
    method: 'GET',
    path: '/issues/:identifier',
    scope: 'read',
    summary: 'One issue with sub-issues, history and comments',
    run: (ctx, caller, { params }) => ctx.issues.get(caller.memberId, params.identifier!),
  },
  {
    method: 'PATCH',
    path: '/issues/:identifier',
    scope: 'issues:write',
    summary: 'Change an issue',
    body: updateIssueSchema,
    run: (ctx, caller, { params, body }) =>
      ctx.issues.update(
        caller.memberId,
        params.identifier!,
        parse(updateIssueSchema, body),
        caller.tokenName,
      ),
  },
  {
    method: 'POST',
    path: '/issues/:identifier/comments',
    scope: 'issues:write',
    summary: 'Comment on an issue (Markdown)',
    body: commentSchema,
    created: true,
    run: (ctx, caller, { params, body }) =>
      ctx.issues.addComment(
        caller.memberId,
        params.identifier!,
        parse(commentSchema, body).body,
        caller.tokenName,
      ),
  },
  {
    method: 'GET',
    path: '/search',
    scope: 'read',
    summary: 'Search issues and requests',
    query: { q: 'Text or identifier' },
    async run(ctx, caller, { query }) {
      const q = parse(z.string().trim().min(1).max(200), query.q);
      const [issues, requests] = await Promise.all([
        ctx.issues.search(caller.memberId, q, 20),
        ctx.requests.search(caller.memberId, q, 20),
      ]);
      return { issues, requests };
    },
  },
  {
    method: 'GET',
    path: '/requests',
    scope: 'read',
    summary: 'Requests the member submitted, oldest first',
    query: PAGE_QUERY,
    paginated: true,
    run: async (ctx, caller, { query }) =>
      paginate(await ctx.requests.mine(caller.memberId), query),
  },
  {
    method: 'POST',
    path: '/requests',
    scope: 'requests:write',
    summary: 'Submit a request through a request type',
    body: createRequestSchema,
    created: true,
    run: (ctx, caller, { body }) =>
      ctx.requests.submit(
        { memberId: caller.memberId, tokenName: caller.tokenName },
        parse(createRequestSchema, body),
      ),
  },
  {
    method: 'GET',
    path: '/requests/:identifier',
    scope: 'read',
    summary: 'One request as the member may see it',
    run: (ctx, caller, { params }) => ctx.requests.get(caller.memberId, params.identifier!),
  },
  {
    method: 'POST',
    path: '/requests/:identifier/comments',
    scope: 'requests:write',
    summary: 'Comment on a request',
    body: requestCommentSchema,
    created: true,
    run: (ctx, caller, { params, body }) =>
      ctx.requests.comment(
        { memberId: caller.memberId, tokenName: caller.tokenName },
        params.identifier!,
        parse(requestCommentSchema, body),
      ),
  },
];

/**
 * Public REST API v1 (SPEC §10): personal tokens only, the same services and RBAC as the UI,
 * cursor pagination, Idempotency-Key on POST and a per-token rate limit.
 */
export class PublicApi {
  private readonly allowedOrigin: string;

  constructor(private readonly ctx: AppContext) {
    this.allowedOrigin = new URL(ctx.baseUrl).origin;
  }

  register(instance: FastifyInstance): void {
    instance.get(`${API_V1}/openapi.json`, (_request, reply) =>
      reply.send(openApiDocument(this.ctx.baseUrl, this.ctx.version)),
    );
    for (const route of ROUTES) {
      instance.route({
        method: route.method,
        url: `${API_V1}${route.path}`,
        handler: (request, reply) => this.handle(route, request, reply),
      });
    }
  }

  private async handle(route: ApiRoute, request: FastifyRequest, reply: FastifyReply) {
    try {
      const caller = await this.authenticate(request);
      if (!caller.scopes.includes(route.scope)) {
        throw new ApiFailure(403, { error: 'insufficient_scope', scope: route.scope });
      }
      const input: RouteInput = {
        params: request.params as Record<string, string>,
        query: request.query as Record<string, string | undefined>,
        body: request.body,
      };
      const key = request.headers['idempotency-key'];
      if (route.method === 'POST' && typeof key === 'string') {
        return await this.idempotent(
          caller,
          key,
          request,
          reply,
          () => route.run(this.ctx, caller, input),
          route,
        );
      }
      const result = await route.run(this.ctx, caller, input);
      return reply.status(route.created ? 201 : 200).send(result);
    } catch (error) {
      if (error instanceof ApiFailure) return reply.status(error.status).send(error.body);
      if (error instanceof DomainError)
        return reply.status(error.status).send({ error: error.code });
      throw error;
    }
  }

  private async authenticate(request: FastifyRequest): Promise<ApiCaller> {
    // Tokens only: a browser session cookie never reaches the public API (no CSRF surface).
    const origin = request.headers.origin;
    if (origin && origin !== this.allowedOrigin)
      throw new ApiFailure(403, { error: 'forbidden_origin' });
    const secret = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
    const token = secret ? await this.ctx.tokens.resolve(secret, request.ip) : undefined;
    if (!token) throw new ApiFailure(401, { error: 'invalid_token' });
    if (!this.ctx.limits.api.attempt(token.tokenId)) {
      throw new ApiFailure(429, { error: 'rate_limited' });
    }
    return {
      memberId: token.memberId,
      tokenId: token.tokenId,
      tokenName: token.name,
      scopes: token.scopes,
    };
  }

  /** The first response for a key is stored and replayed; the key with another body is refused. */
  private async idempotent(
    caller: ApiCaller,
    key: string,
    request: FastifyRequest,
    reply: FastifyReply,
    run: () => Promise<unknown>,
    route: ApiRoute,
  ) {
    if (key.length < 1 || key.length > 200)
      throw new ApiFailure(400, { error: 'validation_failed' });
    const db = this.ctx.db;
    const now = new Date();
    await db
      .delete(apiIdempotencyKeys)
      .where(lt(apiIdempotencyKeys.createdAt, new Date(now.getTime() - IDEMPOTENCY_TTL_MS)));
    const requestHash = createHash('sha256')
      .update(`${request.method} ${request.url}\n${JSON.stringify(request.body ?? null)}`)
      .digest('hex');
    const claimed = await db
      .insert(apiIdempotencyKeys)
      .values({ tokenId: caller.tokenId, key, requestHash })
      .onConflictDoNothing()
      .returning({ key: apiIdempotencyKeys.key });
    const where = and(
      eq(apiIdempotencyKeys.tokenId, caller.tokenId),
      eq(apiIdempotencyKeys.key, key),
    );
    if (claimed.length === 0) {
      const [stored] = await db.select().from(apiIdempotencyKeys).where(where);
      if (stored!.requestHash !== requestHash)
        throw new ApiFailure(422, { error: 'idempotency_key_reused' });
      if (stored!.statusCode === null)
        throw new ApiFailure(409, { error: 'idempotency_in_progress' });
      return reply
        .status(stored!.statusCode)
        .header('idempotent-replayed', 'true')
        .send(stored!.response);
    }
    try {
      const result = await run();
      const status = route.created ? 201 : 200;
      await db
        .update(apiIdempotencyKeys)
        .set({ statusCode: status, response: result as object })
        .where(where);
      return reply.status(status).send(result);
    } catch (error) {
      // Failures are not stored: fixing the request and retrying with the same key works.
      await db.delete(apiIdempotencyKeys).where(where);
      throw error;
    }
  }
}

/** OpenAPI 3.1 for v1, built from the route table and the shared Zod schemas. */
export function openApiDocument(baseUrl: string, version: string | undefined) {
  const paths: Record<string, Record<string, object>> = {};
  for (const route of ROUTES) {
    const path = route.path.replace(/:(\w+)/g, '{$1}');
    const parameters = [
      ...[...route.path.matchAll(/:(\w+)/g)].map((m) => ({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      })),
      ...Object.entries(route.query ?? {}).map(([name, description]) => ({
        name,
        in: 'query',
        required: false,
        description,
        schema: { type: 'string' },
      })),
      ...(route.method === 'POST'
        ? [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: false,
              description: 'Replays the first response for 24 hours instead of repeating the call',
              schema: { type: 'string', maxLength: 200 },
            },
          ]
        : []),
    ];
    paths[path] ??= {};
    paths[path][route.method.toLowerCase()] = {
      summary: route.summary,
      operationId: `${route.method.toLowerCase()}${route.path.replace(/[/:](\w)/g, (_m, c: string) => c.toUpperCase())}`,
      'x-ordler-scope': route.scope,
      security: [{ personalToken: [] }],
      ...(parameters.length ? { parameters } : {}),
      ...(route.body
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: z.toJSONSchema(route.body, { io: 'input', unrepresentable: 'any' }),
                },
              },
            },
          }
        : {}),
      responses: {
        [route.created ? '201' : '200']: {
          description: route.paginated ? 'A page: `data` and `nextCursor`' : 'OK',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        '400': {
          description: 'Invalid input',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        '401': { description: 'Missing, expired or revoked token' },
        '403': { description: 'Not allowed, or the token lacks the scope' },
        '404': { description: 'Not found or not visible to the member' },
        '429': { description: 'Rate limited (600 requests per minute per token)' },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Ordler API',
      version: `1 (${version ?? 'development'})`,
      description:
        'Personal access tokens act exactly as their member: same visibility and permissions as the UI. Approvals cannot be decided through the API.',
      license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
    },
    servers: [{ url: `${baseUrl}${API_V1}` }],
    components: {
      securitySchemes: {
        personalToken: {
          type: 'http',
          scheme: 'bearer',
          description: 'ordl_pat_… from Settings → Access tokens',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string' },
            issues: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
    paths,
  };
}
