import type { FastifyInstance, FastifyReply } from 'fastify';
import { DomainError } from '../auth/errors.js';
import type { OrdlerRequest } from '../http/http.js';
import type { WhiteboardService } from './whiteboard.service.js';

/** A save of many elements, such as a pasted diagram, can be several megabytes. */
const SCENE_BODY_LIMIT = 16 * 1024 * 1024;

/**
 * Saving elements and images (ADR 0015). Plain Fastify routes, because these bodies outgrow
 * the 1 MB default; the global hooks still resolve the session and check the Origin.
 */
export function registerWhiteboardHttp(
  instance: FastifyInstance,
  whiteboards: WhiteboardService,
  maxFileBytes: number,
): void {
  void instance.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    // Images arrive base64-encoded inside JSON: a third larger than the file itself.
    const fileLimit = Math.ceil(maxFileBytes * 1.4) + 4096;
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: Math.max(SCENE_BODY_LIMIT, fileLimit) },
      (_request, body, done) => {
        try {
          done(null, JSON.parse(String(body)));
        } catch {
          done(null, undefined);
        }
      },
    );

    scope.post('/api/whiteboards/:id/scene', async (request, reply) => {
      const member = (request as OrdlerRequest).member;
      if (!member) return reply.status(401).send({ error: 'unauthorized' });
      const { id } = request.params as { id: string };
      try {
        return reply.send(await whiteboards.save(member.id, id, request.body));
      } catch (error) {
        return failure(reply, error);
      }
    });

    scope.post('/api/whiteboards/:id/files', async (request, reply) => {
      const member = (request as OrdlerRequest).member;
      if (!member) return reply.status(401).send({ error: 'unauthorized' });
      const { id } = request.params as { id: string };
      if (Number(request.headers['content-length'] ?? 0) > fileLimit) {
        return reply.status(413).send({ error: 'file_too_large' });
      }
      try {
        await whiteboards.saveFile(member.id, id, request.body as never);
        return reply.status(204).send();
      } catch (error) {
        return failure(reply, error);
      }
    });
  });
}

function failure(reply: FastifyReply, error: unknown) {
  if (error instanceof DomainError) return reply.status(error.status).send({ error: error.code });
  throw error;
}
