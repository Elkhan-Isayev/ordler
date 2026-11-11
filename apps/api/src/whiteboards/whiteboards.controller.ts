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
  issueWhiteboardLinkSchema,
  whiteboardCreateSchema,
  whiteboardUpdateSchema,
} from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated } from '../rbac/permission.guard.js';

/**
 * Whiteboards (SPEC §5.5); WhiteboardService checks team visibility and `whiteboard.edit`.
 * Saving elements and images lives in whiteboard-http.ts, which allows larger bodies.
 */
@Authenticated()
@Controller()
export class WhiteboardsController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get('whiteboards')
  list(@Query('team') team: string | undefined, @Req() request: OrdlerRequest) {
    return this.ctx.whiteboards.list(request.member!.id, team || undefined);
  }

  @Post('whiteboards')
  create(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.whiteboards.create(request.member!.id, parseBody(whiteboardCreateSchema, body));
  }

  @Get('whiteboards/:id')
  get(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.whiteboards.get(request.member!.id, id);
  }

  @Patch('whiteboards/:id')
  rename(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    const { title } = parseBody(whiteboardUpdateSchema, body);
    return this.ctx.whiteboards.rename(request.member!.id, id, title);
  }

  @Delete('whiteboards/:id')
  @HttpCode(204)
  async archive(@Param('id') id: string, @Req() request: OrdlerRequest) {
    await this.ctx.whiteboards.archive(request.member!.id, id);
  }

  @Get('whiteboards/:id/scene')
  scene(
    @Param('id') id: string,
    @Query('since') since: string | undefined,
    @Req() request: OrdlerRequest,
  ) {
    const from = Number(since ?? 0);
    return this.ctx.whiteboards.scene(
      request.member!.id,
      id,
      Number.isSafeInteger(from) && from > 0 ? from : 0,
    );
  }

  @Get('whiteboards/:id/files')
  files(
    @Param('id') id: string,
    @Query('ids') ids: string | undefined,
    @Req() request: OrdlerRequest,
  ) {
    return this.ctx.whiteboards.files(
      request.member!.id,
      id,
      (ids ?? '').split(',').filter(Boolean),
    );
  }

  @Get('issues/:identifier/whiteboards')
  forIssue(@Param('identifier') identifier: string, @Req() request: OrdlerRequest) {
    return this.ctx.whiteboards.forIssue(request.member!.id, identifier);
  }

  @Post('issues/:identifier/whiteboards')
  link(
    @Param('identifier') identifier: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    const { whiteboardId } = parseBody(issueWhiteboardLinkSchema, body);
    return this.ctx.whiteboards.link(request.member!.id, identifier, whiteboardId);
  }

  @Delete('issues/:identifier/whiteboards/:whiteboardId')
  @HttpCode(204)
  async unlink(
    @Param('identifier') identifier: string,
    @Param('whiteboardId') whiteboardId: string,
    @Req() request: OrdlerRequest,
  ) {
    await this.ctx.whiteboards.unlink(request.member!.id, identifier, whiteboardId);
  }
}
