import { DEFAULT_ATTACHMENT_MAX_MB } from '@ordler/shared';
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
import {
  DatabaseSettingsService,
  type DatabaseSettingsDeps,
} from './install/database-settings.service.js';
import { AttachmentService } from './attachments/attachment.service.js';
import { IssueService } from './issues/issue.service.js';
import { RequestService } from './requests/request.service.js';
import { RequestTypeService } from './requests/request-types.service.js';
import { NotificationService } from './notifications/notification.service.js';
import { TokenService } from './tokens/token.service.js';
import { AuditService } from './audit/audit.service.js';
import { RolesService } from './members/roles.service.js';
import { LabelService } from './issues/label.service.js';
import { WorkflowService } from './issues/workflow.service.js';
import { CycleService } from './cycles/cycle.service.js';
import { ProjectService } from './projects/project.service.js';
import { InitiativeService } from './projects/initiative.service.js';
import { ImportService } from './imports/import.service.js';
import { sourceFactory, type SourceFactory } from './imports/sources/index.js';
import type { Notifier } from './notifications/notifier.js';
import { SlackService, type FetchFn as SlackFetchFn } from './notifications/slack.service.js';
import { TeamAccess } from './issues/team-access.js';
import { MailService } from './mail/mail.service.js';
import { LocalEventBus, type EventBus } from './realtime/event-bus.js';
import { RealtimeHub } from './realtime/realtime.gateway.js';
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
  database: DatabaseSettingsService;
  issues: IssueService;
  attachments: AttachmentService;
  requestTypes: RequestTypeService;
  requests: RequestService;
  notifications: NotificationService;
  slack: SlackService;
  tokens: TokenService;
  roles: RolesService;
  labels: LabelService;
  workflow: WorkflowService;
  cycles: CycleService;
  projects: ProjectService;
  initiatives: InitiativeService;
  imports: ImportService;
  audit: AuditService;
  version: string | undefined;
  events: EventBus;
  realtime: RealtimeHub;
  limits: {
    signIn: RateLimiter;
    otpRequest: RateLimiter;
    otpVerify: RateLimiter;
    updateCheck: RateLimiter;
    testMail: RateLimiter;
    slackTest: RateLimiter;
    mcp: RateLimiter;
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
  /** The running connection and how to probe and save replacements (Admin → Database). */
  databaseSettings: Omit<DatabaseSettingsDeps, 'db'>;
  /** Fans domain events out to every replica; PostgreSQL LISTEN/NOTIFY in production. */
  events?: EventBus;
  /** Who hears about approvals, assignments and comments; Inbox, email and Slack in production. */
  notifier?: Notifier;
  /** Outgoing Slack webhook calls; replaced in tests. */
  slackFetch?: SlackFetchFn;
  /** Upload limit per attachment in bytes (ATTACHMENT_MAX_MB). */
  attachmentMaxBytes?: number;
  /** How often open sockets are pinged and their sessions re-checked. */
  realtimeHeartbeatMs?: number;
  readiness: ReadinessCheck;
  now?: Clock;
  argon2?: Argon2Params;
  otpPolicy?: OtpPolicy;
  googleFetch?: FetchFn;
  googleJwks?: JWTVerifyGetKey;
  version?: string | undefined;
  updateCheck?: { enabled: boolean; repository: string };
  updatesFetch?: UpdateFetchFn;
  /** Linear and Jira clients for imports; replaced in tests. */
  importSources?: SourceFactory;
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
  const events = deps.events ?? new LocalEventBus();
  const access = new DbAccessContext(deps.db);
  const teamAccess = new TeamAccess(deps.db, access);
  const notifications = new NotificationService({
    db: deps.db,
    mail,
    events,
    baseUrl: deps.baseUrl,
    log: (message) => console.warn(message),
  });
  const notifier = deps.notifier ?? notifications;
  const slack = new SlackService({
    db: deps.db,
    box,
    access,
    baseUrl: deps.baseUrl,
    log: (message) => console.warn(message),
    ...(deps.slackFetch ? { fetch: deps.slackFetch } : {}),
  });
  const issues = new IssueService({
    db: deps.db,
    access: teamAccess,
    events,
    notifier,
    channels: slack,
    now,
  });
  const projects = new ProjectService({ db: deps.db, access, teamAccess, issues, now });
  const org = new OrgService(deps.db);
  const attachmentMaxBytes = deps.attachmentMaxBytes ?? DEFAULT_ATTACHMENT_MAX_MB * 1024 * 1024;
  const sessionTtlMs = deps.sessionTtlDays * 86_400_000;
  const sessions = new SessionService(deps.db, sessionTtlMs, now);

  return {
    db: deps.db,
    baseUrl: deps.baseUrl,
    secureCookies: deps.baseUrl.startsWith('https://'),
    sessionTtlMs,
    readiness: deps.readiness,
    access,
    setup: new SetupService(deps.db, deps.baseUrl, deps.argon2),
    strategies,
    sessions,
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
    org,
    members: new AdminMembersService({
      db: deps.db,
      baseUrl: deps.baseUrl,
      mail,
      now,
      ...(deps.argon2 ? { argon2: deps.argon2 } : {}),
    }),
    mail,
    database: new DatabaseSettingsService({ db: deps.db, ...deps.databaseSettings }),
    issues,
    requestTypes: new RequestTypeService(deps.db, access),
    requests: new RequestService({
      db: deps.db,
      access,
      teamAccess,
      issues,
      notifier,
      events,
      channels: slack,
      now,
    }),
    notifications,
    slack,
    tokens: new TokenService(deps.db, access, now),
    roles: new RolesService(deps.db, access),
    labels: new LabelService(deps.db, access, teamAccess),
    workflow: new WorkflowService(deps.db, teamAccess, events),
    cycles: new CycleService({ db: deps.db, access: teamAccess, issues, events, now }),
    projects,
    initiatives: new InitiativeService({ db: deps.db, access, projects, now }),
    imports: new ImportService({
      db: deps.db,
      box,
      org,
      events,
      sources: deps.importSources ?? sourceFactory(),
      maxAttachmentBytes: attachmentMaxBytes,
      now,
    }),
    audit: new AuditService(deps.db),
    version: deps.version,
    attachments: new AttachmentService(deps.db, teamAccess, attachmentMaxBytes),
    events,
    realtime: new RealtimeHub({
      baseUrl: deps.baseUrl,
      issues,
      sessions,
      events,
      ...(deps.realtimeHeartbeatMs ? { heartbeatMs: deps.realtimeHeartbeatMs } : {}),
    }),
    limits: {
      signIn: new RateLimiter(10, FIFTEEN_MINUTES),
      otpRequest: new RateLimiter(10, FIFTEEN_MINUTES),
      otpVerify: new RateLimiter(20, FIFTEEN_MINUTES),
      // Manual "check now" clicks; GitHub allows 60 anonymous requests an hour per IP.
      updateCheck: new RateLimiter(1, 60_000),
      testMail: new RateLimiter(10, FIFTEEN_MINUTES),
      slackTest: new RateLimiter(10, FIFTEEN_MINUTES),
      // SPEC §10.1: 120 MCP requests per minute per token.
      mcp: new RateLimiter(120, 60_000),
    },
  };
}
