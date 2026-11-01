import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req } from '@nestjs/common';
import { updateInboxSettingsSchema } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, enforceLimit, parseBody, type OrdlerRequest } from '../http/http.js';
import { RequirePermission } from '../rbac/permission.guard.js';

/** Admin → Mail → Incoming mail (SPEC §7). The IMAP password is accepted but never returned. */
@Controller('admin/mail/inbox')
export class EmailInController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @RequirePermission('mail.manage')
  @Get()
  view() {
    return this.ctx.emailIn.view();
  }

  @RequirePermission('mail.manage')
  @Put()
  update(@Body() body: unknown, @Req() request: OrdlerRequest) {
    const input = parseBody(updateInboxSettingsSchema, body);
    return this.ctx.emailIn.update(input, { type: 'member', id: request.member!.id });
  }

  @RequirePermission('mail.manage')
  @Get('messages')
  messages() {
    return this.ctx.emailIn.messages();
  }

  /** Polls right away and reports the IMAP error verbatim, so admins can fix settings. */
  @RequirePermission('mail.manage')
  @Post('poll')
  @HttpCode(200)
  poll(@Req() request: OrdlerRequest) {
    enforceLimit(this.ctx.limits.testMail.attempt(request.member!.id));
    return this.ctx.emailIn.poll();
  }
}
