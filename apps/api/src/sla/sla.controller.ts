import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { calendarInputSchema, slaPolicyInputSchema } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated } from '../rbac/permission.guard.js';

/** SLA calendars and policies (SPEC §6.5); the service checks sla_policy.manage per department. */
@Authenticated()
@Controller('admin')
export class SlaController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get('departments/:departmentId/calendars')
  calendars(@Param('departmentId') departmentId: string, @Req() request: OrdlerRequest) {
    return this.ctx.sla.calendars(request.member!.id, departmentId);
  }

  @Post('departments/:departmentId/calendars')
  createCalendar(
    @Param('departmentId') departmentId: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    return this.ctx.sla.createCalendar(
      request.member!.id,
      departmentId,
      parseBody(calendarInputSchema, body),
    );
  }

  @Put('calendars/:id')
  updateCalendar(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.sla.updateCalendar(
      request.member!.id,
      id,
      parseBody(calendarInputSchema, body),
    );
  }

  @Post('calendars/:id/archive')
  @HttpCode(204)
  archiveCalendar(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.sla.archiveCalendar(request.member!.id, id);
  }

  @Get('departments/:departmentId/sla-policies')
  policies(@Param('departmentId') departmentId: string, @Req() request: OrdlerRequest) {
    return this.ctx.sla.policies(request.member!.id, departmentId);
  }

  @Post('departments/:departmentId/sla-policies')
  createPolicy(
    @Param('departmentId') departmentId: string,
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
  ) {
    return this.ctx.sla.createPolicy(
      request.member!.id,
      departmentId,
      parseBody(slaPolicyInputSchema, body),
    );
  }

  @Put('sla-policies/:id')
  updatePolicy(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.sla.updatePolicy(request.member!.id, id, parseBody(slaPolicyInputSchema, body));
  }

  @Post('sla-policies/:id/archive')
  @HttpCode(204)
  archivePolicy(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.sla.archivePolicy(request.member!.id, id);
  }
}
