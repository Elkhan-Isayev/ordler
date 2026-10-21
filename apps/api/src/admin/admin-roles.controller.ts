import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { auditQuerySchema, roleInputSchema } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { RequirePermission } from '../rbac/permission.guard.js';

/** Admin → Roles (custom roles) and Admin → Audit log (SPEC §8, §9). */
@Controller('admin')
export class AdminRolesController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @RequirePermission('role.create')
  @Post('roles')
  create(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.roles.create(request.member!.id, parseBody(roleInputSchema, body));
  }

  @RequirePermission('role.update')
  @Put('roles/:id')
  update(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.roles.update(request.member!.id, id, parseBody(roleInputSchema, body));
  }

  @RequirePermission('role.delete')
  @Delete('roles/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.roles.remove(request.member!.id, id);
  }

  @RequirePermission('org.audit.read')
  @Get('audit')
  audit(@Query() query: unknown) {
    return this.ctx.audit.list(parseBody(auditQuerySchema, query));
  }
}
