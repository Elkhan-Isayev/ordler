import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, enforceLimit } from '../http/http.js';
import { RequirePermission } from '../rbac/permission.guard.js';

/** Admin → Updates: new-version notification (SPEC §16.5). */
@Controller('admin/updates')
export class UpdatesController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @RequirePermission('org.manage')
  @Get()
  status() {
    return this.ctx.updates.status();
  }

  @RequirePermission('org.manage')
  @Post('check')
  @HttpCode(200)
  check() {
    enforceLimit(this.ctx.limits.updateCheck.attempt('global'));
    return this.ctx.updates.check();
  }
}
