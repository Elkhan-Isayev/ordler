import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { chatSubscriptionInputSchema, markNotificationsSchema } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, enforceLimit, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated } from '../rbac/permission.guard.js';

/**
 * Inbox, sidebar counters and Slack channel subscriptions (SPEC §7). Every call is scoped to
 * the caller: notifications are personal, subscriptions are checked per team.
 */
@Authenticated()
@Controller()
export class NotificationsController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get('me/notifications')
  list(@Req() request: OrdlerRequest) {
    return this.ctx.notifications.list(request.member!.id);
  }

  @Get('me/counts')
  counts(@Req() request: OrdlerRequest) {
    return this.ctx.notifications.counts(request.member!.id);
  }

  @Post('me/notifications/mark')
  @HttpCode(200)
  mark(@Body() body: unknown, @Req() request: OrdlerRequest) {
    const { ids, read } = parseBody(markNotificationsSchema, body);
    return this.ctx.notifications.mark(request.member!.id, ids, read);
  }

  @Get('integrations/slack')
  slackList(@Req() request: OrdlerRequest) {
    return this.ctx.slack.list(request.member!.id);
  }

  @Post('integrations/slack')
  slackCreate(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.slack.create(request.member!.id, parseBody(chatSubscriptionInputSchema, body));
  }

  @Delete('integrations/slack/:id')
  @HttpCode(204)
  slackRemove(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.slack.remove(request.member!.id, id);
  }

  @Post('integrations/slack/:id/test')
  @HttpCode(200)
  slackTest(@Param('id') id: string, @Req() request: OrdlerRequest) {
    enforceLimit(this.ctx.limits.slackTest.attempt(request.member!.id));
    return this.ctx.slack.test(request.member!.id, id);
  }
}
