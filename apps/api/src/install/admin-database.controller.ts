import { Body, Controller, Get, Inject, Put, Req } from '@nestjs/common';
import { databaseSettingsSchema } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { RequirePermission } from '../rbac/permission.guard.js';

/** Admin → Database: admins see the connection, only Owners change it (SPEC §4.2, §16.3). */
@Controller('admin/database')
export class AdminDatabaseController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @RequirePermission('org.manage')
  @Get()
  view() {
    return this.ctx.database.view();
  }

  @RequirePermission('instance.manage')
  @Put()
  update(@Body() body: unknown, @Req() request: OrdlerRequest) {
    const input = parseBody(databaseSettingsSchema, body);
    return this.ctx.database.update(input, { type: 'member', id: request.member!.id });
  }
}
