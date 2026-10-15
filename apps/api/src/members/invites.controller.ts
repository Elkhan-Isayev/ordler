import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { acceptInviteSchema } from '@ordler/shared';
import type { FastifyReply } from 'fastify';
import type { AppContext } from '../app-context.js';
import {
  APP_CONTEXT,
  enforceLimit,
  parseBody,
  sessionCookie,
  type OrdlerRequest,
} from '../http/http.js';
import { Public } from '../rbac/permission.guard.js';
import { loadMe } from './me.js';

/** The invitee's side of an invitation link: `/invite/<token>` in the web app. */
@Public()
@Controller('invites')
export class InvitesController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get(':token')
  peek(@Param('token') token: string, @Req() request: OrdlerRequest) {
    enforceLimit(this.ctx.limits.signIn.attempt(`invite|${request.ip}`));
    return this.ctx.members.peekInvite(token);
  }

  @Post('accept')
  @HttpCode(200)
  async accept(
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = parseBody(acceptInviteSchema, body);
    enforceLimit(this.ctx.limits.signIn.attempt(`invite|${request.ip}`));
    const memberId = await this.ctx.members.acceptInvite(input.token, input.name, input.password);
    const { token } = await this.ctx.sessions.create(memberId, 'local', {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    reply.header('set-cookie', sessionCookie(this.ctx, token));
    return loadMe(this.ctx.db, memberId);
  }
}
