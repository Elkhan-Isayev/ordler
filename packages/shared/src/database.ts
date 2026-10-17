import { z } from 'zod';

export const DB_SSL_MODES = ['disable', 'require', 'verify-full'] as const;
export type DbSslMode = (typeof DB_SSL_MODES)[number];

const databaseFields = {
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  database: z.string().trim().min(1).max(63),
  user: z.string().trim().min(1).max(63),
  /** Write-only. In the admin panel, omitting it keeps the stored password. */
  password: z.string().max(1024).optional(),
  ssl: z.enum(DB_SSL_MODES),
  sslCa: z.string().trim().max(65536).optional(),
  schema: z
    .string()
    .trim()
    .regex(/^[a-z_][a-z0-9_]*$/, 'schema_invalid')
    .max(63),
};

function requireCaForVerifyFull(
  value: { ssl: DbSslMode; sslCa?: string | undefined },
  ctx: z.RefinementCtx,
) {
  if (value.ssl === 'verify-full' && !value.sslCa) {
    ctx.addIssue({ code: 'custom', path: ['sslCa'], message: 'ssl_ca_required' });
  }
}

/** Database connection entered in the first-run installer or Admin → Database (SPEC §16.3). */
export const databaseSettingsSchema = z.object(databaseFields).superRefine(requireCaForVerifyFull);
export type DatabaseSettingsInput = z.infer<typeof databaseSettingsSchema>;

/** The installer additionally requires the one-time token printed in the container log. */
export const installDatabaseSchema = z
  .object({ ...databaseFields, installToken: z.string().trim().min(1).max(100) })
  .superRefine(requireCaForVerifyFull);
export type InstallDatabaseInput = z.infer<typeof installDatabaseSchema>;

/** Why a connection attempt failed; translated by the UI. */
export const DATABASE_PROBE_ERRORS = [
  'connection_failed',
  'authentication_failed',
  'database_not_found',
  'tls_failed',
  'postgres_too_old',
  'insufficient_privileges',
] as const;
export type DatabaseProbeError = (typeof DATABASE_PROBE_ERRORS)[number];

/** `detail` carries the PostgreSQL message so admins can fix the settings. */
export type DatabaseProbeResult =
  { ok: true; serverVersion: string } | { ok: false; error: DatabaseProbeError; detail?: string };

/** Errors of the installer endpoints, next to the probe errors. */
export const INSTALL_ERROR_CODES = ['invalid_install_token', 'database_required'] as const;

/** Response of GET /api/admin/database. Passwords are never returned. */
export interface DatabaseSettingsView {
  /** `env`: DATABASE_URL or DB_* variables; `file`: saved by the installer in the data volume. */
  source: 'env' | 'file';
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
  ssl: DbSslMode;
  schema: string;
  passwordSet: boolean;
  serverVersion: string | null;
}

/** Response of PUT /api/admin/database; new settings apply after a restart. */
export type DatabaseUpdateResult =
  | { saved: true; restartRequired: true }
  | { saved: false; error: DatabaseProbeError; detail?: string };

/** Response of GET /api/setup/status. */
export interface SetupStatusResponse {
  setupRequired: boolean;
  /** True while Ordler runs the first-run installer and has no database yet. */
  databaseRequired?: boolean;
  /** Set when saved settings stopped working, e.g. after a password change. */
  databaseError?: DatabaseProbeError;
}
