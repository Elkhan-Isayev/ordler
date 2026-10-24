import { Body, Controller, Get, Inject, Param, Patch, Put, Req } from '@nestjs/common';
import { cycleSettingsSchema, updateCycleSchema } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated } from '../rbac/permission.guard.js';

/** Team cycles (SPEC §5.2); CycleService checks team visibility and `team.update`. */
@Authenticated()
@Controller()
export class CyclesController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get('teams/:key/cycles')
  list(@Param('key') key: string, @Req() request: OrdlerRequest) {
    return this.ctx.cycles.list(request.member!.id, key);
  }

  @Put('teams/:key/cycle-settings')
  settings(@Param('key') key: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.cycles.updateSettings(
      request.member!.id,
      key,
      parseBody(cycleSettingsSchema, body),
    );
  }

  @Get('cycles/:id')
  get(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.cycles.get(request.member!.id, id);
  }

  @Patch('cycles/:id')
  rename(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    const { name } = parseBody(updateCycleSchema, body);
    return this.ctx.cycles.rename(request.member!.id, id, name);
  }
}
