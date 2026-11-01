import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import {
  otpRequestSchema,
  otpVerifySchema,
  passwordSignInSchema,
  type AuthStrategyKind,
  type OAuthStrategyKind,
} from '@ordler/shared';
import type { FastifyReply } from 'fastify';
import type { AppContext } from '../app-context.js';
import { clearCookie, parseCookies, serializeCookie } from '../http/cookies.js';
import {
  APP_CONTEXT,
  enforceLimit,
  parseBody,
  sessionCookie,
  type OrdlerRequest,
} from '../http/http.js';
import { loadMe } from '../members/me.js';
import { Authenticated, Public } from '../rbac/permission.guard.js';
import { DomainError } from './errors.js';
import { OAUTH_STATE_COOKIE } from './google.js';
import { SESSION_COOKIE } from './sessions.js';

// Scoped to one provider so parallel sign-in attempts in two tabs do not clobber each other.
function oauthCookiePath(kind: OAuthStrategyKind): string {
  return `/api/auth/${kind}`;
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  /** What the sign-in page renders: enabled and usable strategies, in admin order. */
  @Public()
  @Get('strategies')
  async strategies() {
    const usable = await this.ctx.strategies.usable();
    return usable.map((s) => ({ kind: s.kind, displayName: s.displayName }));
  }

  @Public()
  @Post('password')
  @HttpCode(200)
  async password(
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = parseBody(passwordSignInSchema, body);
    enforceLimit(this.ctx.limits.signIn.attempt(`${request.ip}|${input.email}`));
    const memberId = await this.ctx.passwordAuth.signIn(input.email, input.password);
    return this.startSession(memberId, 'local', request, reply);
  }

  /** Always 202, whether or not a code was sent, so emails cannot be enumerated. */
  @Public()
  @Post('otp/request')
  @HttpCode(202)
  async requestOtp(@Body() body: unknown, @Req() request: OrdlerRequest) {
    const input = parseBody(otpRequestSchema, body);
    enforceLimit(this.ctx.limits.otpRequest.attempt(request.ip));
    await this.ctx.otp.request(input.email);
    return { status: 'accepted' };
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body() body: unknown,
    @Req() request: OrdlerRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = parseBody(otpVerifySchema, body);
    enforceLimit(this.ctx.limits.otpVerify.attempt(request.ip));
    const memberId = await this.ctx.otp.verify(input.email, input.code);
    return this.startSession(memberId, 'email_otp', request, reply);
  }

  @Public()
  @Get('google/start')
  async googleStart(@Res() reply: FastifyReply) {
    await this.oauthStart('google', reply);
  }

  /** Google redirects the browser here; errors go back to the sign-in page as `?auth_error=`. */
  @Public()
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: OrdlerRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.oauthCallback('google', { code, state }, request, reply);
  }

  @Public()
  @Get('microsoft/start')
  async microsoftStart(@Res() reply: FastifyReply) {
    await this.oauthStart('microsoft', reply);
  }

  @Public()
  @Get('microsoft/callback')
  async microsoftCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: OrdlerRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.oauthCallback('microsoft', { code, state }, request, reply);
  }

  @Public()
  @Get('oidc/start')
  async oidcStart(@Res() reply: FastifyReply) {
    await this.oauthStart('oidc', reply);
  }

  @Public()
  @Get('oidc/callback')
  async oidcCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: OrdlerRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.oauthCallback('oidc', { code, state }, request, reply);
  }

  @Authenticated()
  @Post('sign-out')
  @HttpCode(204)
  async signOut(@Req() request: OrdlerRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (token) await this.ctx.sessions.revoke(token);
    reply.header('set-cookie', clearCookie(SESSION_COOKIE, { secure: this.ctx.secureCookies }));
  }

  private async startSession(
    memberId: string,
    strategy: AuthStrategyKind,
    request: OrdlerRequest,
    reply: FastifyReply,
  ) {
    const { token } = await this.ctx.sessions.create(memberId, strategy, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    reply.header('set-cookie', sessionCookie(this.ctx, token));
    return loadMe(this.ctx.db, memberId);
  }

  private async oauthStart(kind: OAuthStrategyKind, reply: FastifyReply): Promise<void> {
    try {
      const { url, stateCookie } =
        kind === 'google' ? await this.ctx.google.start() : await this.ctx.oidc.start(kind);
      await reply
        .header(
          'set-cookie',
          serializeCookie(OAUTH_STATE_COOKIE, stateCookie, {
            secure: this.ctx.secureCookies,
            path: oauthCookiePath(kind),
            maxAgeSeconds: 600,
          }),
        )
        .redirect(url, 302);
    } catch (error) {
      await this.redirectWithError(reply, error);
    }
  }

  private async oauthCallback(
    kind: OAuthStrategyKind,
    query: { code: string | undefined; state: string | undefined },
    request: OrdlerRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const stateCookie = parseCookies(request.headers.cookie)[OAUTH_STATE_COOKIE];
    const clearState = clearCookie(OAUTH_STATE_COOKIE, {
      secure: this.ctx.secureCookies,
      path: oauthCookiePath(kind),
    });
    const input = {
      ...(query.code ? { code: query.code } : {}),
      ...(query.state ? { state: query.state } : {}),
      ...(stateCookie ? { stateCookie } : {}),
    };
    try {
      const memberId =
        kind === 'google'
          ? await this.ctx.google.callback(input)
          : await this.ctx.oidc.callback(kind, input);
      const { token } = await this.ctx.sessions.create(memberId, kind, {
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });
      await reply
        .header('set-cookie', [clearState, sessionCookie(this.ctx, token)])
        .redirect(`${this.ctx.baseUrl}/`, 302);
    } catch (error) {
      reply.header('set-cookie', clearState);
      await this.redirectWithError(reply, error);
    }
  }

  private async redirectWithError(reply: FastifyReply, error: unknown): Promise<void> {
    if (!(error instanceof DomainError)) throw error;
    await reply.redirect(`${this.ctx.baseUrl}/?auth_error=${error.code}`, 302);
  }
}
