import { Controller, Get, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../app-context.js';
import { DomainError } from '../auth/errors.js';
import { APP_CONTEXT, type OrdlerRequest } from '../http/http.js';
import { Authenticated } from '../rbac/permission.guard.js';

/** RFC 6266 header that keeps non-ASCII names (Cyrillic, Azerbaijani) intact. */
export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Uploads and downloads of attachments; AttachmentService checks team access (ADR 0008). */
@Authenticated()
@Controller()
export class AttachmentsController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Post('teams/:key/attachments')
  async upload(@Param('key') key: string, @Req() request: OrdlerRequest & FastifyRequest) {
    if (!request.isMultipart()) throw new DomainError('file_missing');
    const file = await request.file({
      limits: { files: 1, fileSize: this.ctx.attachments.maxBytes },
    });
    if (!file) throw new DomainError('file_missing');
    let data: Buffer;
    try {
      data = await file.toBuffer();
    } catch (error) {
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new DomainError('file_too_large');
      }
      throw error;
    }
    return this.ctx.attachments.upload(request.member!.id, key, {
      filename: file.filename,
      mimetype: file.mimetype,
      data,
    });
  }

  @Get('attachments/:id/:filename')
  async download(
    @Param('id') id: string,
    @Req() request: OrdlerRequest & FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.ctx.attachments.read(request.member!.id, id);
    const etag = `"${file.sha256}"`;
    void reply
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('etag', etag)
      // Uploaded content never runs as a page on Ordler's origin.
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header(
        'content-disposition',
        contentDisposition(file.isImage ? 'inline' : 'attachment', file.filename),
      );
    if (request.headers['if-none-match'] === etag) return reply.status(304).send();
    return reply
      .type(file.isImage ? file.contentType : file.contentType || 'application/octet-stream')
      .send(file.data);
  }
}
