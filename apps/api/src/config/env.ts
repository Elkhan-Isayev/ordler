import { readFileSync } from 'node:fs';
import { DEFAULT_ATTACHMENT_MAX_MB, SUPPORTED_LOCALES } from '@ordler/shared';
import { z } from 'zod';

export type Env = Record<string, string | undefined>;
export type FileReader = (path: string) => string;

export type SslMode = 'disable' | 'require' | 'verify-full';

export interface DatabaseConfig {
  /** Either a full connection string or discrete fields; never both. */
  connectionString?: string;
  host?: string;
  port: number;
  database?: string;
  user?: string;
  password?: string;
  schema: string;
  ssl: SslMode;
  sslCa?: string;
  poolMax: number;
}

export interface SmtpConfig {
  host: string;
  port: number;
  security: 'none' | 'starttls' | 'tls';
  verifyTls: boolean;
  user?: string;
  password?: string;
  from: string;
}

export interface AppConfig {
  port: number;
  baseUrl: string;
  role: 'all' | 'web' | 'worker';
  migrateOnStart: boolean;
  defaultLocale: (typeof SUPPORTED_LOCALES)[number];
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /**
   * From DATABASE_URL or DB_* variables. Absent on installations configured through the
   * first-run installer, whose settings live in the data directory instead.
   */
  database?: DatabaseConfig;
  /** DB_POOL_MAX, also applied to installer-saved settings. */
  dbPoolMax: number;
  /**
   * 32-byte key sealing stored secrets (OAuth, SMTP, database password) and OAuth state
   * cookies. When unset, a key is generated once in the data directory.
   */
  encryptionKey?: Buffer;
  /** Persistent volume for installer settings and the generated key (ORDLER_DATA_DIR). */
  dataDir: string;
  /** Fixed installer token for automated installs; otherwise a random one is logged. */
  installToken?: string;
  /** Built web app served by the API; absent in development, where Vite serves it. */
  webDir?: string;
  /** Upload limit per attachment, in bytes. */
  attachmentMaxBytes: number;
  sessionTtlDays: number;
  /** Absent until SMTP is configured; email OTP stays unavailable meanwhile. */
  smtp?: SmtpConfig;
  /** Release version baked into the image; `undefined` for development builds. */
  version: string | undefined;
  updateCheck: { enabled: boolean; repository: string };
}

/** Public GitHub repository whose releases announce new Ordler versions. */
export const DEFAULT_RELEASE_REPOSITORY = 'Elkhan-Isayev/ordler';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  BASE_URL: z.url().default('http://localhost:3000'),
  ORDLER_ROLE: z.enum(['all', 'web', 'worker']).default('all'),
  ORDLER_MIGRATE: booleanString.default(true),
  DEFAULT_LOCALE: z.enum(SUPPORTED_LOCALES).default('en'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().min(1).optional(),
  DB_HOST: z.string().min(1).optional(),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DB_NAME: z.string().min(1).optional(),
  DB_USER: z.string().min(1).optional(),
  DB_PASS: z.string().optional(),
  DB_SCHEMA: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/, 'DB_SCHEMA must be a lowercase SQL identifier')
    .default('ordler'),
  DB_SSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  DB_SSL_CA: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(500).default(20),
  ENCRYPTION_KEY: z.string().min(1).optional(),
  ORDLER_DATA_DIR: z.string().min(1).default('/data'),
  ORDLER_INSTALL_TOKEN: z.string().trim().min(8).max(100).optional(),
  ORDLER_WEB_DIR: z.string().min(1).optional(),
  ATTACHMENT_MAX_MB: z.coerce.number().int().min(1).max(1024).default(DEFAULT_ATTACHMENT_MAX_MB),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURITY: z.enum(['none', 'starttls', 'tls']).default('starttls'),
  SMTP_VERIFY_TLS: booleanString.default(true),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().min(3).optional(),
  ORDLER_VERSION: z.string().trim().min(1).optional(),
  UPDATE_CHECK: booleanString.default(true),
  UPDATE_CHECK_REPOSITORY: z
    .string()
    .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, 'UPDATE_CHECK_REPOSITORY must be owner/repo')
    .default(DEFAULT_RELEASE_REPOSITORY),
});

/** Variables that may instead be read from a mounted file via `<NAME>_FILE` (Kubernetes secrets). */
const FILE_VARIABLES = [
  'DATABASE_URL',
  'DB_PASS',
  'DB_SSL_CA',
  'ENCRYPTION_KEY',
  'SMTP_PASS',
] as const;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadConfig(env: Env, readFile: FileReader = defaultReadFile): AppConfig {
  // Compose and Helm templates often pass `VAR=` for unset values; treat them as unset.
  const resolved: Env = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== ''),
  );
  for (const name of FILE_VARIABLES) {
    const filePath = resolved[`${name}_FILE`];
    if (!filePath) continue;
    if (resolved[name] !== undefined) {
      throw new ConfigError(`Set either ${name} or ${name}_FILE, not both`);
    }
    resolved[name] = readFile(filePath).trim();
  }

  const parsed = envSchema.safeParse(resolved);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid configuration: ${details}`);
  }
  const e = parsed.data;

  if (e.DATABASE_URL && e.DB_HOST) {
    throw new ConfigError('Set either DATABASE_URL or DB_HOST, not both');
  }
  if (e.DB_SSL === 'verify-full' && !e.DB_SSL_CA) {
    throw new ConfigError('DB_SSL=verify-full requires DB_SSL_CA or DB_SSL_CA_FILE');
  }
  const encryptionKey = e.ENCRYPTION_KEY ? parseEncryptionKey(e.ENCRYPTION_KEY) : undefined;
  if (e.SMTP_HOST && !e.SMTP_FROM) {
    throw new ConfigError('SMTP_FROM is required when SMTP_HOST is set');
  }

  return {
    port: e.PORT,
    baseUrl: e.BASE_URL.replace(/\/+$/, ''),
    role: e.ORDLER_ROLE,
    migrateOnStart: e.ORDLER_MIGRATE,
    defaultLocale: e.DEFAULT_LOCALE,
    logLevel: e.LOG_LEVEL,
    ...(e.DATABASE_URL || e.DB_HOST
      ? {
          database: {
            ...(e.DATABASE_URL
              ? { connectionString: e.DATABASE_URL }
              : { host: e.DB_HOST, database: e.DB_NAME, user: e.DB_USER, password: e.DB_PASS }),
            port: e.DB_PORT,
            schema: e.DB_SCHEMA,
            ssl: e.DB_SSL,
            ...(e.DB_SSL_CA ? { sslCa: e.DB_SSL_CA } : {}),
            poolMax: e.DB_POOL_MAX,
          },
        }
      : {}),
    dbPoolMax: e.DB_POOL_MAX,
    ...(encryptionKey ? { encryptionKey } : {}),
    dataDir: e.ORDLER_DATA_DIR,
    ...(e.ORDLER_INSTALL_TOKEN ? { installToken: e.ORDLER_INSTALL_TOKEN } : {}),
    ...(e.ORDLER_WEB_DIR ? { webDir: e.ORDLER_WEB_DIR } : {}),
    attachmentMaxBytes: e.ATTACHMENT_MAX_MB * 1024 * 1024,
    sessionTtlDays: e.SESSION_TTL_DAYS,
    version: e.ORDLER_VERSION,
    updateCheck: { enabled: e.UPDATE_CHECK, repository: e.UPDATE_CHECK_REPOSITORY },
    ...(e.SMTP_HOST
      ? {
          smtp: {
            host: e.SMTP_HOST,
            port: e.SMTP_PORT,
            security: e.SMTP_SECURITY,
            verifyTls: e.SMTP_VERIFY_TLS,
            ...(e.SMTP_USER ? { user: e.SMTP_USER } : {}),
            ...(e.SMTP_PASS ? { password: e.SMTP_PASS } : {}),
            from: e.SMTP_FROM!,
          },
        }
      : {}),
  };
}

/** Decodes a base64 32-byte key, from ENCRYPTION_KEY or the generated key file. */
export function parseEncryptionKey(value: string): Buffer {
  const key = Buffer.from(value.trim(), 'base64');
  if (key.length !== 32) {
    throw new ConfigError(
      'ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)',
    );
  }
  return key;
}

function defaultReadFile(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Redacted view for startup logs; passwords and connection strings never reach the log. */
export function describeConfig(config: AppConfig): Record<string, unknown> {
  const { database } = config;
  return {
    port: config.port,
    baseUrl: config.baseUrl,
    role: config.role,
    migrateOnStart: config.migrateOnStart,
    database: database
      ? {
          target: database.connectionString ? 'DATABASE_URL' : `${database.host}:${database.port}`,
          schema: database.schema,
          ssl: database.ssl,
          poolMax: database.poolMax,
        }
      : `installer settings in ${config.dataDir}`,
    smtp: config.smtp ? `${config.smtp.host}:${config.smtp.port}` : 'not configured',
    version: config.version ?? 'development',
    updateCheck: config.updateCheck.enabled ? config.updateCheck.repository : 'disabled',
  };
}
