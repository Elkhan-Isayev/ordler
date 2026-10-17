import type {
  DatabaseProbeResult,
  DatabaseSettingsInput,
  DatabaseSettingsView,
  DatabaseUpdateResult,
} from '@ordler/shared';
import { sql } from 'drizzle-orm';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { DatabaseConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import { toDatabaseConfig } from './installer.js';

export interface DatabaseSettingsDeps {
  db: Db;
  /** Where the running connection came from. */
  source: 'env' | 'file';
  current: DatabaseConfig;
  probe: (config: DatabaseConfig) => Promise<DatabaseProbeResult>;
  /** Writes installer-style settings to the data volume. */
  save: (input: DatabaseSettingsInput) => void;
}

/**
 * Admin → Database (SPEC §16.3). Shows the running connection without secrets. Settings
 * saved by the installer can be changed here; they apply after a restart, because the
 * connection pool, migrations and every replica depend on them.
 */
export class DatabaseSettingsService {
  constructor(private readonly deps: DatabaseSettingsDeps) {}

  async view(): Promise<DatabaseSettingsView> {
    const { current, source } = this.deps;
    const fromUrl = current.connectionString
      ? parseConnectionString(current.connectionString)
      : undefined;
    return {
      source,
      host: fromUrl?.host ?? current.host ?? null,
      port: fromUrl?.port ?? current.port,
      database: fromUrl?.database ?? current.database ?? null,
      user: fromUrl?.user ?? current.user ?? null,
      ssl: current.ssl,
      schema: current.schema,
      passwordSet: fromUrl ? fromUrl.passwordSet : Boolean(current.password),
      serverVersion: await this.serverVersion(),
    };
  }

  async update(
    input: DatabaseSettingsInput,
    actor: AuditActor & { id: string },
  ): Promise<DatabaseUpdateResult> {
    if (this.deps.source === 'env') throw new DomainError('database_managed_by_env');
    // An omitted password keeps the one in use, like other write-only secrets.
    const settings: DatabaseSettingsInput = {
      ...input,
      ...(input.password === undefined && this.deps.current.password
        ? { password: this.deps.current.password }
        : {}),
    };
    const result = await this.deps.probe(toDatabaseConfig(settings, this.deps.current.poolMax));
    if (!result.ok)
      return {
        saved: false,
        error: result.error,
        ...(result.detail ? { detail: result.detail } : {}),
      };

    const before = await this.view();
    this.deps.save(settings);
    await writeAudit(this.deps.db, {
      actor,
      action: 'database_settings.updated',
      targetType: 'database_settings',
      before,
      after: { ...settings, password: undefined, passwordChanged: input.password !== undefined },
    });
    return { saved: true, restartRequired: true };
  }

  private async serverVersion(): Promise<string | null> {
    try {
      const result = await this.deps.db.execute(sql`select current_setting('server_version') as v`);
      const rows = (
        Array.isArray(result) ? result : (result as { rows: unknown[] }).rows
      ) as Array<{
        v: string;
      }>;
      return rows[0]?.v ?? null;
    } catch {
      return null;
    }
  }
}

function parseConnectionString(value: string) {
  try {
    const url = new URL(value);
    return {
      host: url.hostname || null,
      port: url.port ? Number(url.port) : 5432,
      database: decodeURIComponent(url.pathname.replace(/^\//, '')) || null,
      user: decodeURIComponent(url.username) || null,
      passwordSet: url.password !== '',
    };
  } catch {
    return { host: null, port: null, database: null, user: null, passwordSet: false };
  }
}
