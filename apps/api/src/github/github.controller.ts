import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import {
  githubManifestSchema,
  updateGithubAppSchema,
  updateTeamGithubSchema,
} from '@ordler/shared';
import type { FastifyReply } from 'fastify';
import type { AppContext } from '../app-context.js';
import { DomainError } from '../auth/errors.js';
import { clearCookie, parseCookies, serializeCookie } from '../http/cookies.js';
import { APP_CONTEXT, parseBody, type OrdlerRequest } from '../http/http.js';
import { Authenticated, RequirePermission } from '../rbac/permission.guard.js';

const STATE_COOKIE = 'ordler_github_manifest';
const STATE_COOKIE_PATH = '/api/admin/github-app';

/** Admin → Integrations → GitHub (ADR 0019). Secrets are never returned. */
@Controller('admin/github-app')
export class AdminGithubAppController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @RequirePermission('integration.manage')
  @Get()
  view() {
    return this.ctx.github.view();
  }

  @RequirePermission('integration.manage')
  @Put()
  update(@Body() body: unknown, @Req() request: OrdlerRequest) {
    const input = parseBody(updateGithubAppSchema, body);
    return this.ctx.github.update(input, { type: 'member', id: request.member!.id });
  }

  /** Starts the manifest flow; the browser then posts the manifest to GitHub. */
  @RequirePermission('integration.manage')
  @Post('manifest')
  async manifest(
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = parseBody(githubManifestSchema, body);
    const { stateCookie, ...start } = await this.ctx.github.manifestStart(
      request.member!.id,
      input,
    );
    reply.header(
      'set-cookie',
      serializeCookie(STATE_COOKIE, stateCookie, {
        secure: this.ctx.secureCookies,
        path: STATE_COOKIE_PATH,
        maxAgeSeconds: 1800,
      }),
    );
    return start;
  }

  /** GitHub redirects here; the result goes back to the admin page as `?github=`. */
  @RequirePermission('integration.manage')
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: OrdlerRequest,
    @Res() reply: FastifyReply,
  ) {
    const stateCookie = parseCookies(request.headers.cookie)[STATE_COOKIE];
    reply.header(
      'set-cookie',
      clearCookie(STATE_COOKIE, { secure: this.ctx.secureCookies, path: STATE_COOKIE_PATH }),
    );
    const back = `${this.ctx.baseUrl}/admin/integrations`;
    try {
      await this.ctx.github.manifestCallback(
        { type: 'member', id: request.member!.id },
        {
          ...(code ? { code } : {}),
          ...(state ? { state } : {}),
          ...(stateCookie ? { stateCookie } : {}),
        },
      );
      await reply.redirect(`${back}?github=created`, 302);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await reply.redirect(`${back}?github_error=${error.code}`, 302);
    }
  }
}

/** Linked branches, pull requests and commits on an issue; team automation settings. */
@Authenticated()
@Controller()
export class GithubController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get('issues/:identifier/github')
  issue(@Param('identifier') identifier: string, @Req() request: OrdlerRequest) {
    return this.ctx.github.issueView(request.member!.id, identifier);
  }

  @Get('teams/:key/github')
  team(@Param('key') key: string, @Req() request: OrdlerRequest) {
    return this.ctx.github.teamSettings(request.member!.id, key);
  }

  @Put('teams/:key/github')
  updateTeam(@Param('key') key: string, @Body() body: unknown, @Req() request: OrdlerRequest) {
    const input = parseBody(updateTeamGithubSchema, body);
    return this.ctx.github.updateTeamSettings(request.member!.id, key, input);
  }
}
