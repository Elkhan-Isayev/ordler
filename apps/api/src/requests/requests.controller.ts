import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import {
  approvalDecisionSchema,
  createRequestGroupSchema,
  createRequestSchema,
  requestActionSchema,
  requestCommentSchema,
  requesterActionSchema,
  requestTypeInputSchema,
  resubmitRequestSchema,
} from '@ordler/shared';
import { z } from 'zod';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated } from '../rbac/permission.guard.js';
import { loadDirectory } from '../members/directory.js';
import type { Actor } from './request.service.js';

const spawnIssueSchema = z.object({ title: z.string().trim().max(255).optional() });
const linkIssueSchema = z.object({ identifier: z.string().trim().min(3).max(40) });

function actor(request: OrdlerRequest): Actor {
  return { memberId: request.member!.id, tokenName: request.member!.tokenName };
}

/**
 * Service portals, requests and approvals (SPEC §6). Routes need a session; RequestService
 * and RequestTypeService check permissions and visibility on every call.
 */
@Authenticated()
@Controller()
export class RequestsController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get('directory')
  directory() {
    return loadDirectory(this.ctx.db);
  }

  @Get('portals')
  portals(@Req() request: OrdlerRequest) {
    return this.ctx.requestTypes.portals(request.member!.id);
  }

  @Get('request-types/:id')
  requestType(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.requestTypes.get(request.member!.id, id);
  }

  @Get('admin/departments/:departmentId/request-types')
  listTypes(@Param('departmentId') departmentId: string, @Req() request: OrdlerRequest) {
    return this.ctx.requestTypes.listForDepartment(request.member!.id, departmentId);
  }

  @Post('admin/departments/:departmentId/request-types')
  createType(
    @Param('departmentId') departmentId: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    return this.ctx.requestTypes.create(
      request.member!.id,
      departmentId,
      parseBody(requestTypeInputSchema, body),
    );
  }

  @Put('admin/request-types/:id')
  updateType(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.requestTypes.update(
      request.member!.id,
      id,
      parseBody(requestTypeInputSchema, body),
    );
  }

  @Post('admin/request-types/:id/archive')
  @HttpCode(204)
  archiveType(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.requestTypes.archive(request.member!.id, id);
  }

  @Post('requests')
  submit(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.requests.submit(actor(request), parseBody(createRequestSchema, body));
  }

  @Post('request-groups')
  submitGroup(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.requests.submitGroup(actor(request), parseBody(createRequestGroupSchema, body));
  }

  @Get('me/requests')
  mine(@Req() request: OrdlerRequest) {
    return this.ctx.requests.mine(request.member!.id);
  }

  @Get('me/approvals')
  approvals(@Req() request: OrdlerRequest) {
    return this.ctx.requests.pendingApprovals(request.member!.id);
  }

  @Get('teams/:key/requests')
  teamQueue(@Param('key') key: string, @Req() request: OrdlerRequest) {
    return this.ctx.requests.teamQueue(request.member!.id, key);
  }

  @Get('departments/:id/requests')
  departmentQueue(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.requests.departmentQueue(request.member!.id, id);
  }

  @Get('requests/:identifier')
  get(@Param('identifier') identifier: string, @Req() request: OrdlerRequest) {
    return this.ctx.requests.get(request.member!.id, identifier);
  }

  @Get('request-groups/:identifier')
  getGroup(@Param('identifier') identifier: string, @Req() request: OrdlerRequest) {
    return this.ctx.requests.getGroup(request.member!.id, identifier);
  }

  @Post('requests/:identifier/actions')
  @HttpCode(200)
  act(
    @Param('identifier') identifier: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    return this.ctx.requests.act(actor(request), identifier, parseBody(requestActionSchema, body));
  }

  @Post('requests/:identifier/requester-actions')
  @HttpCode(200)
  requesterAct(
    @Param('identifier') identifier: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    return this.ctx.requests.requesterAct(
      actor(request),
      identifier,
      parseBody(requesterActionSchema, body),
    );
  }

  @Post('requests/:identifier/resubmit')
  @HttpCode(200)
  resubmit(
    @Param('identifier') identifier: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    return this.ctx.requests.resubmit(
      actor(request),
      identifier,
      parseBody(resubmitRequestSchema, body),
    );
  }

  @Post('requests/:identifier/comments')
  comment(
    @Param('identifier') identifier: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    return this.ctx.requests.comment(
      actor(request),
      identifier,
      parseBody(requestCommentSchema, body),
    );
  }

  @Post('requests/:identifier/issues')
  spawnIssue(
    @Param('identifier') identifier: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    const { title } = parseBody(spawnIssueSchema, body);
    return this.ctx.requests.spawnIssue(actor(request), identifier, title);
  }

  @Post('requests/:identifier/links')
  linkIssue(
    @Param('identifier') identifier: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    const { identifier: issue } = parseBody(linkIssueSchema, body);
    return this.ctx.requests.linkIssue(actor(request), identifier, issue);
  }

  @Post('approvals/:stepId/decision')
  @HttpCode(200)
  decide(@Param('stepId') stepId: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.requests.decide(
      actor(request),
      stepId,
      parseBody(approvalDecisionSchema, body),
    );
  }
}
