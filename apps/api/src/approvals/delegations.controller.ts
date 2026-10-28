import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { delegationInputSchema } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated } from '../rbac/permission.guard.js';

/** Settings → Out of office (SPEC §6.3): each member manages only their own delegations. */
@Authenticated()
@Controller('me/delegations')
export class DelegationsController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get()
  list(@Req() request: OrdlerRequest) {
    return this.ctx.delegations.list(request.member!.id);
  }

  @Post()
  create(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.delegations.create(request.member!.id, parseBody(delegationInputSchema, body));
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.delegations.revoke(request.member!.id, id);
  }
}
