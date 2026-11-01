import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import { oauthAuthorizeSchema, oauthDecisionSchema } from '@ordler/shared';
import type { AppContext } from '../app-context.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated } from '../rbac/permission.guard.js';

/**
 * Consent for MCP clients (SPEC §10.1): the web page at /oauth/authorize asks here what is
 * being requested, then posts the member's answer. Signed-in members only.
 */
@Authenticated()
@Controller('oauth/consent')
export class OAuthConsentController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get()
  view(@Query() query: unknown, @Req() request: OrdlerRequest) {
    return this.ctx.oauth.consent(request.member!.id, parseBody(oauthAuthorizeSchema, query));
  }

  @Post()
  @HttpCode(200)
  decide(@Body() body: unknown, @Req() request: OrdlerRequest) {
    const { approve, scopes, ...query } = parseBody(oauthDecisionSchema, body);
    return this.ctx.oauth.decide(request.member!.id, query, approve, scopes);
  }
}
