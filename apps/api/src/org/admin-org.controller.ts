import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import {
  createDepartmentSchema,
  createTeamBodySchema,
  updateDepartmentSchema,
  updateTeamSchema,
} from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { departmentFromParam, RequirePermission, teamFromParam } from '../rbac/permission.guard.js';

const actor = (request: OrdlerRequest) => ({ type: 'member' as const, id: request.member!.id });

/** Admin → Departments and teams (SPEC §8). */
@Controller('admin')
export class AdminOrgController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @RequirePermission('org.manage')
  @Get('departments')
  list() {
    return this.ctx.org.list();
  }

  @RequirePermission('department.create')
  @Post('departments')
  async createDepartment(@Body() body: unknown, @Req() request: OrdlerRequest) {
    const input = parseBody(createDepartmentSchema, body);
    return { id: await this.ctx.org.createDepartment(input.name, actor(request)) };
  }

  @RequirePermission('department.update', departmentFromParam())
  @Patch('departments/:departmentId')
  @HttpCode(204)
  async updateDepartment(
    @Param('departmentId') id: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    await this.ctx.org.updateDepartment(
      id,
      parseBody(updateDepartmentSchema, body),
      actor(request),
    );
  }

  @RequirePermission('department.archive', departmentFromParam())
  @Post('departments/:departmentId/archive')
  @HttpCode(204)
  async archiveDepartment(@Param('departmentId') id: string, @Req() request: OrdlerRequest) {
    await this.ctx.org.archiveDepartment(id, actor(request));
  }

  @RequirePermission('team.create', departmentFromParam())
  @Post('departments/:departmentId/teams')
  async createTeam(
    @Param('departmentId') departmentId: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    const input = parseBody(createTeamBodySchema, body);
    return { id: await this.ctx.org.createTeam(departmentId, input, actor(request)) };
  }

  @RequirePermission('team.update', teamFromParam())
  @Patch('teams/:teamId')
  @HttpCode(204)
  async updateTeam(
    @Param('teamId') id: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    await this.ctx.org.updateTeam(id, parseBody(updateTeamSchema, body), actor(request));
  }

  @RequirePermission('team.archive', teamFromParam())
  @Post('teams/:teamId/archive')
  @HttpCode(204)
  async archiveTeam(@Param('teamId') id: string, @Req() request: OrdlerRequest) {
    await this.ctx.org.archiveTeam(id, actor(request));
  }
}
