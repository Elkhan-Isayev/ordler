import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req } from '@nestjs/common';
import { isLocale, sendTestMailSchema, updateMailSettingsSchema } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, enforceLimit, parseBody, type OrdlerRequest } from '../http/http.js';
import { RequirePermission } from '../rbac/permission.guard.js';
import { getInstance } from '../setup/setup.service.js';

/** Admin → Mail server (SPEC §8.2). The SMTP password is accepted but never returned. */
@Controller('admin/mail')
export class AdminMailController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @RequirePermission('mail.manage')
  @Get()
  view() {
    return this.ctx.mail.view();
  }

  @RequirePermission('mail.manage')
  @Put()
  update(@Body() body: unknown, @Req() request: OrdlerRequest) {
    const input = parseBody(updateMailSettingsSchema, body);
    return this.ctx.mail.update(input, { type: 'member', id: request.member!.id });
  }

  @RequirePermission('mail.manage')
  @Post('test')
  @HttpCode(200)
  async test(@Body() body: unknown, @Req() request: OrdlerRequest) {
    const { to } = parseBody(sendTestMailSchema, body);
    enforceLimit(this.ctx.limits.testMail.attempt(request.member!.id));
    const instance = await getInstance(this.ctx.db);
    const locale = instance && isLocale(instance.defaultLocale) ? instance.defaultLocale : 'en';
    return this.ctx.mail.sendTest(to, locale, instance?.companyName ?? 'Ordler');
  }
}
