import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  wikiFolderCreateSchema,
  wikiFolderUpdateSchema,
  wikiImportConnectSchema,
  wikiImportStartSchema,
  wikiPageCreateSchema,
  wikiPageUpdateSchema,
  wikiSpaceUpdateSchema,
} from '@ordler/shared';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../app-context.js';
import { DomainError } from '../auth/errors.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated } from '../rbac/permission.guard.js';

/** Department wikis (SPEC §5.6); WikiService and WikiImportService check every access. */
@Authenticated()
@Controller('wiki')
export class WikiController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get('spaces')
  spaces(@Req() request: OrdlerRequest) {
    return this.ctx.wiki.spaces(request.member!.id);
  }

  @Get('spaces/:department')
  tree(@Param('department') department: string, @Req() request: OrdlerRequest) {
    return this.ctx.wiki.tree(request.member!.id, department);
  }

  @Patch('spaces/:department')
  setVisibility(
    @Param('department') department: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    const { visibility } = parseBody(wikiSpaceUpdateSchema, body);
    return this.ctx.wiki.setVisibility(request.member!.id, department, visibility);
  }

  @Post('spaces/:department/files')
  async upload(
    @Param('department') department: string,
    @Req() request: OrdlerRequest & FastifyRequest,
  ) {
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
    return this.ctx.wiki.upload(request.member!.id, department, {
      filename: file.filename,
      mimetype: file.mimetype,
      data,
    });
  }

  @Get('spaces/:department/imports')
  imports(@Param('department') department: string, @Req() request: OrdlerRequest) {
    return this.ctx.wikiImports.list(request.member!.id, department);
  }

  @Get('search')
  search(
    @Query('q') q: string | undefined,
    @Query('department') department: string | undefined,
    @Req() request: OrdlerRequest,
  ) {
    return this.ctx.wiki.search(request.member!.id, q ?? '', department || undefined);
  }

  @Post('folders')
  createFolder(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.wiki.createFolder(request.member!.id, parseBody(wikiFolderCreateSchema, body));
  }

  @Patch('folders/:id')
  updateFolder(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.wiki.updateFolder(
      request.member!.id,
      id,
      parseBody(wikiFolderUpdateSchema, body),
    );
  }

  @Delete('folders/:id')
  @HttpCode(204)
  async deleteFolder(@Param('id') id: string, @Req() request: OrdlerRequest) {
    await this.ctx.wiki.deleteFolder(request.member!.id, id);
  }

  @Post('pages')
  createPage(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.wiki.createPage(request.member!.id, parseBody(wikiPageCreateSchema, body));
  }

  @Get('pages/:id')
  page(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.wiki.page(request.member!.id, id);
  }

  @Patch('pages/:id')
  updatePage(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.wiki.updatePage(request.member!.id, id, parseBody(wikiPageUpdateSchema, body));
  }

  @Delete('pages/:id')
  @HttpCode(204)
  async deletePage(@Param('id') id: string, @Req() request: OrdlerRequest) {
    await this.ctx.wiki.archivePage(request.member!.id, id);
  }

  @Get('pages/:id/revisions')
  revisions(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.wiki.revisions(request.member!.id, id);
  }

  @Get('pages/:id/revisions/:version')
  revision(
    @Param('id') id: string,
    @Param('version') version: string,
    @Req() request: OrdlerRequest,
  ) {
    const n = Number(version);
    if (!Number.isSafeInteger(n) || n < 1) throw new DomainError('not_found');
    return this.ctx.wiki.revision(request.member!.id, id, n);
  }

  @Post('imports')
  connect(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.wikiImports.connect(
      request.member!.id,
      parseBody(wikiImportConnectSchema, body),
    );
  }

  @Get('imports/:id')
  importRun(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.wikiImports.get(request.member!.id, id);
  }

  @Get('imports/:id/pages')
  importPages(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.wikiImports.pages(request.member!.id, id);
  }

  @Post('imports/:id/start')
  start(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.wikiImports.start(
      request.member!.id,
      id,
      parseBody(wikiImportStartSchema, body),
    );
  }

  @Post('imports/:id/cancel')
  cancel(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.wikiImports.cancel(request.member!.id, id);
  }
}
