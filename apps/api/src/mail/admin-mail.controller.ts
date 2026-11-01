import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  EMAIL_TEMPLATE_KEYS,
  isLocale,
  sendTestMailSchema,
  updateEmailTemplateSchema,
  updateMailSettingsSchema,
  type EmailTemplateKey,
  type Locale,
} from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, enforceLimit, parseBody, type OrdlerRequest } from '../http/http.js';
import { RequirePermission } from '../rbac/permission.guard.js';
import { getInstance } from '../setup/setup.service.js';
import {
  EMAIL_TEMPLATE_SAMPLES,
  listEmailTemplates,
  renderTemplateText,
  resetEmailTemplate,
  saveEmailTemplate,
  validateTemplateText,
} from './templates.js';

function templateParams(key: string, locale: string): { key: EmailTemplateKey; locale: Locale } {
  if (!(EMAIL_TEMPLATE_KEYS as readonly string[]).includes(key) || !isLocale(locale)) {
    throw new NotFoundException();
  }
  return { key: key as EmailTemplateKey, locale };
}

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

  @RequirePermission('mail.manage')
  @Get('templates')
  templates() {
    return listEmailTemplates(this.ctx.db);
  }

  @RequirePermission('mail.manage')
  @Put('templates/:key/:locale')
  async saveTemplate(
    @Param('key') rawKey: string,
    @Param('locale') rawLocale: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    const { key, locale } = templateParams(rawKey, rawLocale);
    const text = parseBody(updateEmailTemplateSchema, body);
    await saveEmailTemplate(this.ctx.db, key, locale, text, {
      type: 'member',
      id: request.member!.id,
    });
    return listEmailTemplates(this.ctx.db);
  }

  @RequirePermission('mail.manage')
  @Delete('templates/:key/:locale')
  async resetTemplate(
    @Param('key') rawKey: string,
    @Param('locale') rawLocale: string,
    @Req() request: OrdlerRequest,
  ) {
    const { key, locale } = templateParams(rawKey, rawLocale);
    await resetEmailTemplate(this.ctx.db, key, locale, { type: 'member', id: request.member!.id });
    return listEmailTemplates(this.ctx.db);
  }

  /** Renders unsaved text with sample values, so admins see mistakes before saving. */
  @RequirePermission('mail.manage')
  @Post('templates/:key/:locale/preview')
  @HttpCode(200)
  preview(@Param('key') rawKey: string, @Param('locale') rawLocale: string, @Body() body: unknown) {
    const { key, locale } = templateParams(rawKey, rawLocale);
    const text = parseBody(updateEmailTemplateSchema, body);
    validateTemplateText(key, text);
    return renderTemplateText(text, locale, EMAIL_TEMPLATE_SAMPLES[key]);
  }
}
