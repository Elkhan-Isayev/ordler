import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { assignRoleSchema, inviteMemberSchema, updateMemberStatusSchema } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { RequirePermission, teamFromParam } from '../rbac/permission.guard.js';

const actor = (request: OrdlerRequest) => ({ type: 'member' as const, id: request.member!.id });

/** Admin → Members (SPEC §8): invites, status, roles and team membership. */
@Controller('admin')
export class AdminMembersController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @RequirePermission('org.manage')
  @Get('members')
  list() {
    return this.ctx.members.list();
  }

  @RequirePermission('member.role.assign')
  @Get('roles')
  roles() {
    return this.ctx.members.roles();
  }

  @RequirePermission('member.invite')
  @Post('members')
  invite(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.members.invite(parseBody(inviteMemberSchema, body), actor(request));
  }

  @RequirePermission('member.invite')
  @Post('members/:memberId/invite')
  reinvite(@Param('memberId') memberId: string, @Req() request: OrdlerRequest) {
    return this.ctx.members.reinvite(memberId, actor(request));
  }

  @RequirePermission('member.deactivate')
  @Patch('members/:memberId')
  setStatus(
    @Param('memberId') memberId: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    const { status } = parseBody(updateMemberStatusSchema, body);
    return this.ctx.members.setStatus(memberId, status, actor(request));
  }

  @RequirePermission('member.role.assign')
  @Post('members/:memberId/roles')
  assignRole(
    @Param('memberId') memberId: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    return this.ctx.members.assignRole(memberId, parseBody(assignRoleSchema, body), actor(request));
  }

  @RequirePermission('member.role.assign')
  @Delete('members/:memberId/roles/:assignmentId')
  removeRole(
    @Param('memberId') memberId: string,
    @Param('assignmentId') assignmentId: string,
    @Req() request: OrdlerRequest,
  ) {
    return this.ctx.members.removeRole(memberId, assignmentId, actor(request));
  }

  @RequirePermission('team.update', teamFromParam())
  @Put('teams/:teamId/members/:memberId')
  addToTeam(
    @Param('teamId') teamId: string,
    @Param('memberId') memberId: string,
    @Req() request: OrdlerRequest,
  ) {
    return this.ctx.members.addToTeam(memberId, teamId, actor(request));
  }

  @RequirePermission('team.update', teamFromParam())
  @Delete('teams/:teamId/members/:memberId')
  removeFromTeam(
    @Param('teamId') teamId: string,
    @Param('memberId') memberId: string,
    @Req() request: OrdlerRequest,
  ) {
    return this.ctx.members.removeFromTeam(memberId, teamId, actor(request));
  }
}
