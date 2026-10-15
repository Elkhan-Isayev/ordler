import type { JWTVerifyGetKey } from 'jose';
import { GoogleAuthService, type FetchFn } from './auth/google.js';
import { DEFAULT_OTP_POLICY, OtpService, type OtpPolicy } from './auth/otp.js';
import { PasswordAuthService } from './auth/password-auth.js';
import { RateLimiter } from './auth/rate-limiter.js';
import { SessionService, type Clock } from './auth/sessions.js';
import { StrategyService } from './auth/strategies.js';
import type { Argon2Params } from './crypto/password.js';
import { SecretBox } from './crypto/secret-box.js';
import type { Db } from './db/client.js';
import type { ReadinessCheck } from './health/health.controller.js';
import type { Mailer } from './mail/mailer.js';
import { DbAccessContext } from './rbac/db-access-context.js';
import type { AccessContextSource } from './rbac/permission.guard.js';
import { SetupService } from './setup/setup.service.js';

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
  limits: {
    signIn: RateLimiter;
    otpRequest: RateLimiter;
    otpVerify: RateLimiter;
  };
}

export interface AppContextDeps {
  db: Db;
  baseUrl: string;
  encryptionKey: Buffer;
  sessionTtlDays: number;
  mailer: Mailer | undefined;
  readiness: ReadinessCheck;
  now?: Clock;
  argon2?: Argon2Params;
  otpPolicy?: OtpPolicy;
  googleFetch?: FetchFn;
  googleJwks?: JWTVerifyGetKey;
}

export function createAppContext(deps: AppContextDeps): AppContext {
  const box = new SecretBox(deps.encryptionKey);
  const now = deps.now ?? (() => new Date());
  const strategies = new StrategyService(deps.db, box, deps.mailer !== undefined);
  const sessionTtlMs = deps.sessionTtlDays * 86_400_000;
  const unconfiguredMailer: Mailer = {
    send: async () => {
      throw new Error('SMTP is not configured');
    },
  };

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
    otp: new OtpService(
      deps.db,
      strategies,
      deps.mailer ?? unconfiguredMailer,
      deps.otpPolicy ?? DEFAULT_OTP_POLICY,
      now,
    ),
    google: new GoogleAuthService({
      db: deps.db,
      strategies,
      box,
      baseUrl: deps.baseUrl,
      now,
      ...(deps.googleFetch ? { fetch: deps.googleFetch } : {}),
      ...(deps.googleJwks ? { jwks: deps.googleJwks } : {}),
    }),
    limits: {
      signIn: new RateLimiter(10, FIFTEEN_MINUTES),
      otpRequest: new RateLimiter(10, FIFTEEN_MINUTES),
      otpVerify: new RateLimiter(20, FIFTEEN_MINUTES),
    },
  };
}
