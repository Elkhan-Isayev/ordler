import type { FastifyInstance } from 'fastify';
import type { GithubPayload, GithubService } from './github.service.js';

/**
 * GitHub App webhooks (ADR 0019). The raw body is kept for the `X-Hub-Signature-256` check, so
 * the route gets its own body parser; nothing is parsed before the signature matches.
 */
export function registerGithubHttp(
  instance: FastifyInstance,
  github: GithubService,
  log: (message: string) => void = () => undefined,
): void {
  void instance.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      '*',
      { parseAs: 'string', bodyLimit: 5 * 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );

    scope.post('/api/github/webhook', async (request, reply) => {
      const body = typeof request.body === 'string' ? request.body : '';
      const signature = header(request.headers['x-hub-signature-256']);
      if (!(await github.verifySignature(signature, body))) {
        return reply.status(401).send({ error: 'invalid_signature' });
      }
      let payload: GithubPayload;
      try {
        payload = JSON.parse(body) as GithubPayload;
      } catch {
        return reply.status(400).send({ error: 'invalid_body' });
      }
      const event = header(request.headers['x-github-event']) ?? '';
      try {
        await github.handleWebhook(event, header(request.headers['x-github-delivery']), payload);
      } catch (error) {
        // GitHub shows failed deliveries and lets admins redeliver them.
        log(`GitHub webhook ${event} failed: ${String(error)}`);
        return reply.status(500).send({ error: 'failed' });
      }
      return reply.status(202).send();
    });
  });
}

function header(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
