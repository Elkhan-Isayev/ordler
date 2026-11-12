import { mePreferencesSchema } from '@ordler/shared';
import { Body, Controller, Get, Inject, Patch, Req, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { members } from '../db/schema.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated } from '../rbac/permission.guard.js';
import { loadMe } from './me.js';

@Controller('me')
export class MeController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Authenticated()
  @Get()
  async me(@Req() request: OrdlerRequest) {
    const me = await loadMe(this.ctx.db, request.member!.id);
    if (!me) throw new UnauthorizedException();
    return me;
  }

  /** Own preferences only: no permission beyond being signed in, never someone else's row. */
  @Authenticated()
  @Patch('preferences')
  async preferences(@Body() body: unknown, @Req() request: OrdlerRequest) {
    const input = parseBody(mePreferencesSchema, body);
    await this.ctx.db
      .update(members)
      .set({ theme: input.theme === 'system' ? null : input.theme })
      .where(eq(members.id, request.member!.id));
    return this.me(request);
  }
}
