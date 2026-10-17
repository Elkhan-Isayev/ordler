import type { JWTVerifyGetKey } from 'jose';
import { GoogleAuthService, type FetchFn } from './auth/google.js';
import { DEFAULT_OTP_POLICY, OtpService, type OtpPolicy } from './auth/otp.js';
import { PasswordAuthService } from './auth/password-auth.js';
import { RateLimiter } from './auth/rate-limiter.js';
import { SessionService, type Clock } from './auth/sessions.js';
import { StrategyService } from './auth/strategies.js';
import type { Argon2Params } from './crypto/password.js';
import { DEFAULT_RELEASE_REPOSITORY, type SmtpConfig } from './config/env.js';
import { SecretBox } from './crypto/secret-box.js';
import type { Db } from './db/client.js';
import type { ReadinessCheck } from './health/health.controller.js';
import { MailService } from './mail/mail.service.js';
import { smtpTransport, type TransportFactory } from './mail/mailer.js';
import { AdminMembersService } from './members/admin-members.service.js';
import { OrgService } from './org/org.service.js';
import { DbAccessContext } from './rbac/db-access-context.js';
import type { AccessContextSource } from './rbac/permission.guard.js';
import { SetupService } from './setup/setup.service.js';
import type { FetchFn as UpdateFetchFn } from './updates/github.js';
import { UpdateService } from './updates/update.service.js';

const FIFTEEN_MINUTES = 15 * 60_000;

/** Everything request handlers need, built once at startup (and per test). */
export interface AppContext {
  db: Db;
  baseUrl: string;
  secureCookies: boolean;
  sessionTtlMs: number;
  readiness: ReadinessCheck;
  access: AccessContextSource;
  setup: SetupService;
  strategies: StrategyService;
  sessions: SessionService;
  passwordAuth: PasswordAuthService;
  otp: OtpService;
  google: GoogleAuthService;
  updates: UpdateService;
  org: OrgService;
  members: AdminMembersService;
  mail: MailService;
  limits: {
    signIn: RateLimiter;
    otpRequest: RateLimiter;
    otpVerify: RateLimiter;
    updateCheck: RateLimiter;
    testMail: RateLimiter;
  };
}

export interface AppContextDeps {
  db: Db;
  baseUrl: string;
  encryptionKey: Buffer;
  sessionTtlDays: number;
  /** SMTP_* variables; otherwise mail settings come from Admin → Mail server. */
  smtp?: SmtpConfig | undefined;
  mailTransport?: TransportFactory;
  readiness: ReadinessCheck;
  now?: Clock;
  argon2?: Argon2Params;
  otpPolicy?: OtpPolicy;
  googleFetch?: FetchFn;
  googleJwks?: JWTVerifyGetKey;
  version?: string | undefined;
  updateCheck?: { enabled: boolean; repository: string };
  updatesFetch?: UpdateFetchFn;
}

export function createAppContext(deps: AppContextDeps): AppContext {
  const box = new SecretBox(deps.encryptionKey);
  const now = deps.now ?? (() => new Date());
  const mail = new MailService({
    db: deps.db,
    box,
    transport: deps.mailTransport ?? smtpTransport,
    env: deps.smtp,
    now,
  });
  const strategies = new StrategyService(deps.db, box, mail);
  const sessionTtlMs = deps.sessionTtlDays * 86_400_000;

  return {
    db: deps.db,
    baseUrl: deps.baseUrl,
    secureCookies: deps.baseUrl.startsWith('https://'),
    sessionTtlMs,
    readiness: deps.readiness,
    access: new DbAccessContext(deps.db),
    setup: new SetupService(deps.db, deps.baseUrl, deps.argon2),
    strategies,
    sessions: new SessionService(deps.db, sessionTtlMs, now),
    passwordAuth: new PasswordAuthService(deps.db, strategies, deps.argon2),
    otp: new OtpService(deps.db, strategies, mail, deps.otpPolicy ?? DEFAULT_OTP_POLICY, now),
    google: new GoogleAuthService({
      db: deps.db,
      strategies,
      box,
      baseUrl: deps.baseUrl,
      now,
      ...(deps.googleFetch ? { fetch: deps.googleFetch } : {}),
      ...(deps.googleJwks ? { jwks: deps.googleJwks } : {}),
    }),
    updates: new UpdateService({
      db: deps.db,
      enabled: deps.updateCheck?.enabled ?? false,
      repository: deps.updateCheck?.repository ?? DEFAULT_RELEASE_REPOSITORY,
      currentVersion: deps.version,
      now,
      ...(deps.updatesFetch ? { fetch: deps.updatesFetch } : {}),
    }),
    org: new OrgService(deps.db),
    members: new AdminMembersService({
      db: deps.db,
      baseUrl: deps.baseUrl,
      mail,
      now,
      ...(deps.argon2 ? { argon2: deps.argon2 } : {}),
    }),
    mail,
    limits: {
      signIn: new RateLimiter(10, FIFTEEN_MINUTES),
      otpRequest: new RateLimiter(10, FIFTEEN_MINUTES),
      otpVerify: new RateLimiter(20, FIFTEEN_MINUTES),
      // Manual "check now" clicks; GitHub allows 60 anonymous requests an hour per IP.
      updateCheck: new RateLimiter(1, 60_000),
      testMail: new RateLimiter(10, FIFTEEN_MINUTES),
    },
  };
}
