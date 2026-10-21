import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app-context.js';
import { DomainError } from '../auth/errors.js';
import { holdsAnywhere } from '../tokens/token.service.js';
import { issueFull, requestFull, TOOLS, type McpCaller } from './tools.js';

export const MCP_PATH = '/mcp';

/** Newest first; an unknown client version gets the newest one we speak. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
/** Keeps tool results small enough for agent context windows. */
const MAX_RESULT_CHARS = 60_000;

const RESOURCE_TEMPLATES = [
  { uriTemplate: 'ordler://issue/{identifier}', name: 'Issue', mimeType: 'application/json' },
  { uriTemplate: 'ordler://request/{identifier}', name: 'Request', mimeType: 'application/json' },
  { uriTemplate: 'ordler://team/{key}', name: 'Team', mimeType: 'application/json' },
];

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

const rpcSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

function truncate(text: string): string {
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n… truncated; narrow the query or lower "limit".`
    : text;
}

/**
 * Built-in MCP server (SPEC §10.1, ADR 0009): Streamable HTTP in stateless JSON mode. Every
 * call authenticates with a personal token and runs through the same services, RBAC and
 * validation as the UI; nothing here can decide approvals.
 */
export class McpServer {
  private readonly allowedOrigin: string;

  constructor(
    private readonly ctx: AppContext,
    private readonly version = '0.0.0',
  ) {
    this.allowedOrigin = new URL(ctx.baseUrl).origin;
  }

  register(instance: FastifyInstance): void {
    instance.post(MCP_PATH, (request, reply) => this.post(request, reply));
    // No server-initiated streams or sessions in stateless mode.
    const notAllowed = async (_request: FastifyRequest, reply: FastifyReply) =>
      reply.status(405).header('allow', 'POST').send({ error: 'method_not_allowed' });
    instance.get(MCP_PATH, notAllowed);
    instance.delete(MCP_PATH, notAllowed);
  }

  private async post(request: FastifyRequest, reply: FastifyReply) {
    // Browsers may not drive the endpoint from other sites (DNS-rebinding defence).
    const origin = request.headers.origin;
    if (origin && origin !== this.allowedOrigin) {
      return reply.status(403).send({ error: 'forbidden_origin' });
    }
    const header = request.headers.authorization ?? '';
    const secret = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    const token = secret ? await this.ctx.tokens.resolve(secret, request.ip) : undefined;
    if (!token) {
      return reply
        .status(401)
        .header('www-authenticate', 'Bearer realm="ordler"')
        .send({ error: 'invalid_token' });
    }
    if (!(await this.ctx.tokens.settings()).mcpEnabled) {
      return reply.status(403).send({ error: 'mcp_disabled' });
    }
    if (!holdsAnywhere(await this.ctx.access.load(token.memberId), 'mcp.use')) {
      return reply.status(403).send({ error: 'forbidden' });
    }
    if (!this.ctx.limits.mcp.attempt(token.tokenId)) {
      return reply.status(429).header('retry-after', '60').send({ error: 'rate_limited' });
    }

    const caller: McpCaller = {
      memberId: token.memberId,
      tokenName: token.name,
      scopes: token.scopes,
    };
    const body = request.body;
    const messages = Array.isArray(body) ? body : [body];
    const responses = [];
    for (const message of messages) {
      const response = await this.handle(caller, message);
      if (response) responses.push(response);
    }
    // Only notifications: accepted, nothing to answer.
    if (responses.length === 0) return reply.status(202).send();
    return reply
      .header('content-type', 'application/json')
      .send(Array.isArray(body) ? responses : responses[0]);
  }

  /** One JSON-RPC message; undefined for notifications. */
  async handle(caller: McpCaller, raw: unknown): Promise<object | undefined> {
    const parsed = rpcSchema.safeParse(raw);
    if (!parsed.success) {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
    }
    const message = parsed.data as JsonRpcRequest;
    if (message.id === undefined) return undefined;
    try {
      const result = await this.dispatch(caller, message);
      return { jsonrpc: '2.0', id: message.id, result };
    } catch (error) {
      const rpc = error instanceof RpcError ? error : new RpcError(-32603, 'Internal error');
      return { jsonrpc: '2.0', id: message.id, error: { code: rpc.code, message: rpc.message } };
    }
  }

  private async dispatch(caller: McpCaller, message: JsonRpcRequest): Promise<unknown> {
    const params = message.params ?? {};
    switch (message.method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        return {
          protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: { name: 'ordler', title: 'Ordler', version: this.version },
          instructions:
            'Ordler issues and cross-department requests. You act as the member who owns the token, ' +
            'with their permissions. Approvals are read-only: humans decide them in Ordler.',
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return {
          tools: [...TOOLS.values()]
            .filter((tool) => caller.scopes.includes(tool.scope))
            .map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: z.toJSONSchema(tool.input, { io: 'input' }),
              annotations: { readOnlyHint: tool.scope === 'read' },
            })),
        };
      case 'tools/call':
        return this.callTool(caller, params);
      case 'resources/templates/list':
        return { resourceTemplates: caller.scopes.includes('read') ? RESOURCE_TEMPLATES : [] };
      case 'resources/list': {
        if (!caller.scopes.includes('read')) return { resources: [] };
        const issues = await this.ctx.issues.assignedTo(caller.memberId);
        return {
          resources: issues.slice(0, 50).map((issue) => ({
            uri: `ordler://issue/${issue.identifier}`,
            name: `${issue.identifier} ${issue.title}`,
            mimeType: 'application/json',
          })),
        };
      }
      case 'resources/read':
        return this.readResource(caller, String(params.uri ?? ''));
      default:
        throw new RpcError(-32601, `Method not found: ${message.method}`);
    }
  }

  private async callTool(caller: McpCaller, params: Record<string, unknown>) {
    const tool = TOOLS.get(String(params.name ?? ''));
    if (!tool) throw new RpcError(-32602, `Unknown tool: ${String(params.name)}`);
    if (!caller.scopes.includes(tool.scope)) {
      return this.toolError(`This token lacks the "${tool.scope}" scope.`);
    }
    const args = tool.input.safeParse(params.arguments ?? {});
    if (!args.success) {
      return this.toolError(
        `Invalid arguments: ${args.error.issues.map((i) => `${i.path.join('.') || 'input'} ${i.message}`).join('; ')}`,
      );
    }
    try {
      const result = await tool.run(this.ctx, caller, args.data as never);
      return { content: [{ type: 'text', text: truncate(JSON.stringify(result, null, 2)) }] };
    } catch (error) {
      if (error instanceof DomainError) return this.toolError(`Ordler refused: ${error.code}`);
      throw error;
    }
  }

  private toolError(text: string) {
    return { isError: true, content: [{ type: 'text', text }] };
  }

  private async readResource(caller: McpCaller, uri: string) {
    if (!caller.scopes.includes('read')) throw new RpcError(-32002, 'Resource not found');
    const match = /^ordler:\/\/(issue|request|team)\/([A-Za-z0-9-]{1,40})$/.exec(uri);
    if (!match) throw new RpcError(-32002, 'Resource not found');
    const [, kind, id] = match;
    let data: unknown;
    try {
      if (kind === 'issue')
        data = issueFull(this.ctx, await this.ctx.issues.get(caller.memberId, id!));
      else if (kind === 'request') {
        data = requestFull(this.ctx, await this.ctx.requests.get(caller.memberId, id!));
      } else {
        const team = await this.ctx.issues.team(caller.memberId, id!.toUpperCase());
        data = {
          key: team.key,
          name: team.name,
          department: team.department.name,
          statuses: team.statuses.map((s) => s.name),
          members: team.members.map((m) => m.name),
        };
      }
    } catch (error) {
      if (error instanceof DomainError) throw new RpcError(-32002, 'Resource not found');
      throw error;
    }
    return {
      contents: [
        { uri, mimeType: 'application/json', text: truncate(JSON.stringify(data, null, 2)) },
      ],
    };
  }
}
