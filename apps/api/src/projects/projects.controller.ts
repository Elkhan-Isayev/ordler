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
import {
  milestoneInputSchema,
  projectInputSchema,
  projectUpdateInputSchema,
  updateProjectSchema,
} from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated } from '../rbac/permission.guard.js';

/** Projects (SPEC §5.2); ProjectService checks visibility and `project.manage` per team. */
@Authenticated()
@Controller()
export class ProjectsController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get('projects')
  list(@Req() request: OrdlerRequest) {
    return this.ctx.projects.list(request.member!.id);
  }

  @Get('teams/:key/projects')
  team(@Param('key') key: string, @Req() request: OrdlerRequest) {
    return this.ctx.projects.list(request.member!.id, key);
  }

  @Post('projects')
  create(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.projects.create(request.member!.id, parseBody(projectInputSchema, body));
  }

  @Get('projects/:id')
  get(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.projects.get(request.member!.id, id);
  }

  @Patch('projects/:id')
  update(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.projects.update(request.member!.id, id, parseBody(updateProjectSchema, body));
  }

  @Delete('projects/:id')
  @HttpCode(204)
  archive(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.projects.archive(request.member!.id, id);
  }

  @Post('projects/:id/updates')
  post(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.projects.postUpdate(
      request.member!.id,
      id,
      parseBody(projectUpdateInputSchema, body),
    );
  }

  @Post('projects/:id/milestones')
  addMilestone(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.projects.addMilestone(
      request.member!.id,
      id,
      parseBody(milestoneInputSchema, body),
    );
  }

  @Patch('milestones/:id')
  updateMilestone(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.projects.updateMilestone(
      request.member!.id,
      id,
      parseBody(milestoneInputSchema, body),
    );
  }

  @Delete('milestones/:id')
  removeMilestone(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.projects.removeMilestone(request.member!.id, id);
  }
}
