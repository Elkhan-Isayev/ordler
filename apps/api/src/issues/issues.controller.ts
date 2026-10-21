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
  Query,
  Req,
} from '@nestjs/common';
import {
  commentBodySchema,
  searchQuerySchema,
  createIssueSchema,
  createLabelSchema,
  labelInputSchema,
  triageActionSchema,
  updateIssueSchema,
} from '@ordler/shared';
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

  @Post('issues/:identifier/comments')
  comment(
    @Param('identifier') identifier: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    const { body: text } = parseBody(commentBodySchema, body);
    return this.ctx.issues.addComment(request.member!.id, identifier, text);
  }

  @Patch('comments/:id')
  editComment(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    const { body: text } = parseBody(commentBodySchema, body);
    return this.ctx.issues.editComment(request.member!.id, id, text);
  }

  @Delete('comments/:id')
  deleteComment(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.issues.deleteComment(request.member!.id, id);
  }

  @Get('teams/:key/triage')
  triage(@Param('key') key: string, @Req() request: OrdlerRequest) {
    return this.ctx.issues.triage(request.member!.id, key);
  }

  @Post('issues/:identifier/triage')
  @HttpCode(200)
  decideTriage(
    @Param('identifier') identifier: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    return this.ctx.issues.decideTriage(
      request.member!.id,
      identifier,
      parseBody(triageActionSchema, body),
    );
  }

  @Get('me/issues')
  mine(@Req() request: OrdlerRequest) {
    return this.ctx.issues.assignedTo(request.member!.id);
  }

  @Post('labels')
  createLabel(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.labels.create(request.member!.id, parseBody(createLabelSchema, body));
  }

  @Patch('labels/:id')
  updateLabel(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.labels.update(request.member!.id, id, parseBody(labelInputSchema, body));
  }

  @Delete('labels/:id')
  @HttpCode(204)
  removeLabel(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.labels.remove(request.member!.id, id);
  }

  /** Cmd+K search (SPEC §5.4): issues and requests the member can open. */
  @Get('search')
  async search(@Query() query: unknown, @Req() request: OrdlerRequest) {
    const { q, limit } = parseBody(searchQuerySchema, query);
    const [issues, requests] = await Promise.all([
      this.ctx.issues.search(request.member!.id, q, limit),
      this.ctx.requests.search(request.member!.id, q, limit),
    ]);
    return { issues, requests };
  }
}
