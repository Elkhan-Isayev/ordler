import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Req,
} from '@nestjs/common';
import {
  AUTH_STRATEGY_KINDS,
  updateAuthStrategySchema,
  type AuthStrategyKind,
} from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { RequirePermission } from '../rbac/permission.guard.js';

/** Admin → Authentication (SPEC §8.1). Secret values are accepted but never returned. */
@Controller('admin/auth/strategies')
export class AdminStrategiesController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @RequirePermission('auth.manage')
  @Get()
  async list() {
    const strategies = await this.ctx.strategies.list();
    return strategies.map((strategy) => ({
      ...strategy,
      usable: this.ctx.strategies.isUsable(strategy),
      callbackUrl: strategy.kind === 'google' ? this.ctx.google.redirectUri : null,
    }));
  }

  @RequirePermission('auth.manage')
  @Patch(':kind')
  async update(@Param('kind') kind: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    if (!(AUTH_STRATEGY_KINDS as readonly string[]).includes(kind)) throw new NotFoundException();
    const input = parseBody(updateAuthStrategySchema, body);
    const member = request.member!;
    return this.ctx.strategies.update(
      kind as AuthStrategyKind,
      input,
      { type: 'member', id: member.id },
      member.strategyKind ?? 'local',
    );
  }
}
