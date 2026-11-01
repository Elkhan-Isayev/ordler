import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Patch,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { updateSlackAppSchema, updateSlackLinkSchema } from '@ordler/shared';
import type { FastifyReply } from 'fastify';
import type { AppContext } from '../app-context.js';
import { DomainError } from '../auth/errors.js';
import { clearCookie, parseCookies, serializeCookie } from '../http/cookies.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated, RequirePermission } from '../rbac/permission.guard.js';

const LINK_COOKIE = 'ordler_slack_link';
const LINK_COOKIE_PATH = '/api/me/slack';

/** Admin → Integrations → Slack app (SPEC §7.1, level 2). Secrets are never returned. */
@Controller('admin/slack-app')
export class AdminSlackAppController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @RequirePermission('org.manage')
  @Get()
  view() {
    return this.ctx.slackApp.view();
  }

  @RequirePermission('org.manage')
  @Put()
  update(@Body() body: unknown, @Req() request: OrdlerRequest) {
    const input = parseBody(updateSlackAppSchema, body);
    return this.ctx.slackApp.update(input, { type: 'member', id: request.member!.id });
  }

  @RequirePermission('org.manage')
  @Get('manifest')
  manifest() {
    return this.ctx.slackApp.manifest();
  }
}

/** A member links their own Slack account; only the linked member can act from Slack. */
@Authenticated()
@Controller('me/slack')
export class MySlackController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get()
  view(@Req() request: OrdlerRequest) {
    return this.ctx.slackApp.link(request.member!.id);
  }

  @Patch()
  update(@Body() body: unknown, @Req() request: OrdlerRequest) {
    const { directMessages } = parseBody(updateSlackLinkSchema, body);
    return this.ctx.slackApp.setDirectMessages(request.member!.id, directMessages);
  }

  @Delete()
  @HttpCode(204)
  async unlink(@Req() request: OrdlerRequest) {
    await this.ctx.slackApp.unlink(request.member!.id);
  }

  @Get('start')
  async start(@Req() request: OrdlerRequest, @Res() reply: FastifyReply) {
    try {
      const { url, stateCookie } = await this.ctx.slackApp.linkStart(request.member!.id);
      await reply
        .header(
          'set-cookie',
          serializeCookie(LINK_COOKIE, stateCookie, {
            secure: this.ctx.secureCookies,
            path: LINK_COOKIE_PATH,
            maxAgeSeconds: 600,
          }),
        )
        .redirect(url, 302);
    } catch (error) {
      await this.back(reply, error);
    }
  }

  /** Slack redirects here; the result goes back to the settings page as `?slack=`. */
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: OrdlerRequest,
    @Res() reply: FastifyReply,
  ) {
    const stateCookie = parseCookies(request.headers.cookie)[LINK_COOKIE];
    reply.header(
      'set-cookie',
      clearCookie(LINK_COOKIE, { secure: this.ctx.secureCookies, path: LINK_COOKIE_PATH }),
    );
    try {
      await this.ctx.slackApp.linkCallback(request.member!.id, {
        ...(code ? { code } : {}),
        ...(state ? { state } : {}),
        ...(stateCookie ? { stateCookie } : {}),
      });
      await reply.redirect(`${this.ctx.baseUrl}/settings/slack?slack=linked`, 302);
    } catch (error) {
      await this.back(reply, error);
    }
  }

  private async back(reply: FastifyReply, error: unknown): Promise<void> {
    if (!(error instanceof DomainError)) throw error;
    await reply.redirect(`${this.ctx.baseUrl}/settings/slack?slack_error=${error.code}`, 302);
  }
}
