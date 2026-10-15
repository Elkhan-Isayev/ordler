import { Controller, Get, Inject, Req, UnauthorizedException } from '@nestjs/common';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, type OrdlerRequest } from '../http/http.js';
import { Authenticated } from '../rbac/permission.guard.js';
import { loadMe } from './me.js';

@Controller('me')
export class MeController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Authenticated()
  @Get()
  async me(@Req() request: OrdlerRequest) {
    const me = await loadMe(this.ctx.db, request.member!.id);
    if (!me) throw new UnauthorizedException();
    return me;
  }
}
