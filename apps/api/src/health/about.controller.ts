import { Controller, Get, Inject } from '@nestjs/common';
import type { AboutResponse } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT } from '../http/http.js';
import { Public } from '../rbac/permission.guard.js';

/** Version and source offer; public, because AGPL §13 covers everyone who uses the instance. */
@Public()
@Controller()
export class AboutController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get('about')
  about(): AboutResponse {
    return {
      version: this.ctx.version ?? 'development',
      license: 'AGPL-3.0-only',
      sourceUrl: this.ctx.sourceUrl,
    };
  }
}
