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
  Req,
} from '@nestjs/common';
import { createWebhookSchema, updateWebhookSchema } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { RequirePermission } from '../rbac/permission.guard.js';

/** Admin → Webhooks (SPEC §10): endpoints, signing secrets and the delivery log. */
@Controller('admin/webhooks')
export class WebhooksController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @RequirePermission('webhook.manage')
  @Get()
  list() {
    return this.ctx.webhooks.list();
  }

  @RequirePermission('webhook.manage')
  @Post()
  create(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.webhooks.create(request.member!.id, parseBody(createWebhookSchema, body));
  }

  @RequirePermission('webhook.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.webhooks.update(request.member!.id, id, parseBody(updateWebhookSchema, body));
  }

  @RequirePermission('webhook.manage')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.webhooks.remove(request.member!.id, id);
  }

  @RequirePermission('webhook.manage')
  @Post(':id/rotate-secret')
  rotate(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.webhooks.rotateSecret(request.member!.id, id);
  }

  @RequirePermission('webhook.manage')
  @Post(':id/test')
  test(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.webhooks.test(request.member!.id, id);
  }

  @RequirePermission('webhook.manage')
  @Get(':id/deliveries')
  deliveries(@Param('id') id: string) {
    return this.ctx.webhooks.deliveries(id);
  }

  @RequirePermission('webhook.manage')
  @Post('deliveries/:deliveryId/redeliver')
  redeliver(@Param('deliveryId') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.webhooks.redeliver(request.member!.id, id);
  }
}
