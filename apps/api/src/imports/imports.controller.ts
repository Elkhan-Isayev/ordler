import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import { importConfigSchema, importConnectSchema } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { RequirePermission } from '../rbac/permission.guard.js';

/** Admin → Import (SPEC §10.2): organization admins only. */
@Controller('admin/imports')
export class ImportsController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @RequirePermission('org.manage')
  @Get()
  list() {
    return this.ctx.imports.list();
  }

  @RequirePermission('org.manage')
  @Post()
  connect(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.imports.connect(request.member!.id, parseBody(importConnectSchema, body));
  }

  @RequirePermission('org.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.ctx.imports.get(id);
  }

  @RequirePermission('org.manage')
  @Get(':id/options')
  options(@Param('id') id: string, @Query('containers') containers: string | undefined) {
    return this.ctx.imports.options(id, containers?.split(',').filter(Boolean));
  }

  @RequirePermission('org.manage')
  @Put(':id/config')
  configure(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.imports.configure(request.member!.id, id, parseBody(importConfigSchema, body));
  }

  @RequirePermission('org.manage')
  @Post(':id/dry-run')
  dryRun(@Param('id') id: string) {
    return this.ctx.imports.dryRun(id);
  }

  @RequirePermission('org.manage')
  @Post(':id/start')
  start(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.imports.start(request.member!.id, id);
  }

  @RequirePermission('org.manage')
  @Post(':id/pause')
  pause(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.imports.pause(request.member!.id, id);
  }

  @RequirePermission('org.manage')
  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.imports.cancel(request.member!.id, id);
  }
}
