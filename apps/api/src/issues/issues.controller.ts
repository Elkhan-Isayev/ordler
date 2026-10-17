import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { createIssueSchema, updateIssueSchema } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated } from '../rbac/permission.guard.js';

/**
 * Team issues (SPEC §5). Routes are open to signed-in members; IssueService checks the team
 * permissions (issue.read/create/update/assign and private-team visibility) on every call.
 */
@Authenticated()
@Controller()
export class IssuesController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get('teams/:key')
  team(@Param('key') key: string, @Req() request: OrdlerRequest) {
    return this.ctx.issues.team(request.member!.id, key);
  }

  @Get('teams/:key/issues')
  list(@Param('key') key: string, @Req() request: OrdlerRequest) {
    return this.ctx.issues.list(request.member!.id, key);
  }

  @Post('teams/:key/issues')
  create(@Param('key') key: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.issues.create(request.member!.id, key, parseBody(createIssueSchema, body));
  }

  @Get('issues/:identifier')
  get(@Param('identifier') identifier: string, @Req() request: OrdlerRequest) {
    return this.ctx.issues.get(request.member!.id, identifier);
  }

  @Patch('issues/:identifier')
  update(
    @Param('identifier') identifier: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    return this.ctx.issues.update(
      request.member!.id,
      identifier,
      parseBody(updateIssueSchema, body),
    );
  }

  @Get('me/issues')
  mine(@Req() request: OrdlerRequest) {
    return this.ctx.issues.assignedTo(request.member!.id);
  }
}
