import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { createTokenSchema, tokenSettingsSchema } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated, RequirePermission } from '../rbac/permission.guard.js';

/**
 * Settings → Access tokens and Admin → Access tokens and MCP (SPEC §10.1). Browser sessions
 * only: the REST API does not accept personal tokens in the MVP.
 */
@Controller()
export class TokensController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Authenticated()
  @Get('me/tokens')
  async mine(@Req() request: OrdlerRequest) {
    return {
      tokens: await this.ctx.tokens.list(request.member!.id),
      settings: await this.ctx.tokens.settings(),
    };
  }

  @Authenticated()
  @Post('me/tokens')
  create(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.tokens.create(request.member!.id, parseBody(createTokenSchema, body));
  }

  @Authenticated()
  @Delete('me/tokens/:id')
  @HttpCode(204)
  revoke(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.tokens.revoke(request.member!.id, id);
  }

  @RequirePermission('org.manage')
  @Get('admin/tokens')
  async all(@Req() request: OrdlerRequest) {
    return {
      tokens: await this.ctx.tokens.listAll(request.member!.id),
      settings: await this.ctx.tokens.settings(),
    };
  }

  @RequirePermission('org.manage')
  @Put('admin/tokens/settings')
  settings(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.tokens.updateSettings(request.member!.id, parseBody(tokenSettingsSchema, body));
  }

  @RequirePermission('org.manage')
  @Delete('admin/tokens/:id')
  @HttpCode(204)
  adminRevoke(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.tokens.revoke(request.member!.id, id);
  }
}
