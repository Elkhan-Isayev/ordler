import type { FastifyInstance } from 'fastify';
import type { SlackAppService, SlackPayload } from './slack-app.service.js';

/**
 * Events API and interactivity over HTTPS, the alternative to Socket Mode (SPEC §7.1). Raw
 * bodies are kept for the signature check, so these routes get their own body parsers.
 */
export function registerSlackHttp(instance: FastifyInstance, app: SlackAppService): void {
  void instance.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      '*',
      { parseAs: 'string', bodyLimit: 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );

    const verified = async (request: { headers: Record<string, unknown>; body: unknown }) =>
      app.verifySignature(
        header(request.headers['x-slack-request-timestamp']),
        header(request.headers['x-slack-signature']),
        typeof request.body === 'string' ? request.body : '',
      );

    scope.post('/api/slack/events', async (request, reply) => {
      if (!(await verified(request))) return reply.status(401).send({ error: 'invalid_signature' });
      const payload = parse(String(request.body)) as SlackPayload;
      if (payload.type === 'url_verification') return reply.send({ challenge: payload.challenge });
      // Slack wants an answer within 3 s; unfurls finish in the background.
      if (payload.type === 'event_callback') void app.handleEvent(payload).catch(() => undefined);
      return reply.status(200).send();
    });

    scope.post('/api/slack/interactivity', async (request, reply) => {
      if (!(await verified(request))) return reply.status(401).send({ error: 'invalid_signature' });
      const form = new URLSearchParams(String(request.body));
      const payload = parse(form.get('payload') ?? '') as SlackPayload;
      const result = await app.handleInteraction(payload);
      return result ? reply.send(result) : reply.status(200).send();
    });
  });
}

function header(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
