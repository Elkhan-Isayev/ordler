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
  Put,
  Req,
} from '@nestjs/common';
import {
  initiativeInputSchema,
  initiativeProjectsSchema,
  updateInitiativeSchema,
} from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated } from '../rbac/permission.guard.js';

/** Initiatives (SPEC §5.2); InitiativeService checks `initiative.manage` and ownership. */
@Authenticated()
@Controller('initiatives')
export class InitiativesController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get()
  list(@Req() request: OrdlerRequest) {
    return this.ctx.initiatives.list(request.member!.id);
  }

  @Post()
  create(@Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.initiatives.create(request.member!.id, parseBody(initiativeInputSchema, body));
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.initiatives.get(request.member!.id, id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.initiatives.update(
      request.member!.id,
      id,
      parseBody(updateInitiativeSchema, body),
    );
  }

  @Put(':id/projects')
  projects(@Param('id') id: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    const { projectIds } = parseBody(initiativeProjectsSchema, body);
    return this.ctx.initiatives.setProjects(request.member!.id, id, projectIds);
  }

  @Delete(':id')
  @HttpCode(204)
  archive(@Param('id') id: string, @Req() request: OrdlerRequest) {
    return this.ctx.initiatives.archive(request.member!.id, id);
  }
}
