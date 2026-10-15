import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { setupSchema } from '@ordler/shared';
import type { FastifyReply } from 'fastify';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, sessionCookie, type OrdlerRequest } from '../http/http.js';
import { loadMe } from '../members/me.js';
import { Public } from '../rbac/permission.guard.js';

@Public()
@Controller('setup')
export class SetupController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get('status')
  async status() {
    return { setupRequired: await this.ctx.setup.isSetupRequired() };
  }

  /** First-run wizard: creates the Owner and signs them in. Refused once setup is done. */
  @Post()
  @HttpCode(201)
  async complete(
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = parseBody(setupSchema, body);
    const { ownerId } = await this.ctx.setup.completeSetup(input);
    await this.ctx.strategies.ensureDefaults();
    const { token } = await this.ctx.sessions.create(ownerId, 'local', {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    reply.header('set-cookie', sessionCookie(this.ctx, token));
    return loadMe(this.ctx.db, ownerId);
  }
}
