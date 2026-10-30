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
  Req,
} from '@nestjs/common';
import { viewInputSchema, viewUpdateSchema } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated } from '../rbac/permission.guard.js';

/** Saved views (SPEC §5.4); ViewService checks team visibility and `view.create_shared`. */
@Authenticated()
@Controller()
export class ViewsController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get('views')
  listAll(@Req() request: OrdlerRequest) {
    return this.ctx.views.listAll(request.member!.id);
  }

  @Get('teams/:key/views')
  list(@Param('key') key: string, @Req() request: OrdlerRequest) {
    return this.ctx.views.listTeam(request.member!.id, key);
  }

  @Post('teams/:key/views')
  create(@Param('key') key: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.views.create(request.member!.id, key, parseBody(viewInputSchema, body));
  }

  @Get('views/:id')
  get(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.views.get(request.member!.id, id);
  }

  @Patch('views/:id')
  update(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.views.update(request.member!.id, id, parseBody(viewUpdateSchema, body));
  }

  @Delete('views/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() request: OrdlerRequest) {
    await this.ctx.views.remove(request.member!.id, id);
  }
}
