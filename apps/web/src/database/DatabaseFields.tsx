import {
  DB_SSL_MODES,
  type DatabaseProbeResult,
  type DatabaseSettingsInput,
  type DbSslMode,
} from '@ordler/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { inputClass } from '../admin/common.js';

const labelClass = 'flex flex-col gap-1 text-xs text-ink-muted';

export interface DatabaseDefaults {
  host?: string | null;
  port?: number | null;
  database?: string | null;
  user?: string | null;
  ssl?: DbSslMode;
  schema?: string;
}

/** PostgreSQL connection fields shared by the installer and Admin → Database. */
export function DatabaseFields({
  defaults = {},
  passwordSet = false,
}: {
  defaults?: DatabaseDefaults;
  passwordSet?: boolean;
}) {
  const { t } = useTranslation();
  const [ssl, setSsl] = useState<DbSslMode>(defaults.ssl ?? 'disable');

  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
      <label className={labelClass}>
        {t('database.host')}
        <input
          name="host"
          required
          defaultValue={defaults.host ?? ''}
          placeholder="ordler.xxxx.eu-central-1.rds.amazonaws.com"
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t('database.port')}
        <input
          name="port"
          type="number"
          required
          min={1}
          max={65535}
          defaultValue={defaults.port ?? 5432}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t('database.name')}
        <input
          name="database"
          required
          defaultValue={defaults.database ?? 'ordler'}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t('database.schema')}
        <input
          name="schema"
          required
          pattern="[a-z_][a-z0-9_]*"
          defaultValue={defaults.schema ?? 'ordler'}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t('database.user')}
        <input
          name="user"
          required
          autoComplete="off"
          defaultValue={defaults.user ?? 'ordler'}
          className={inputClass}
        />
      </label>
      <div className={labelClass}>
        <label className="flex flex-col gap-1">
          {t('database.password')}
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder={passwordSet ? '••••••••' : ''}
            aria-describedby={passwordSet ? 'database-password-hint' : undefined}
            className={inputClass}
          />
        </label>
        {passwordSet && (
          <span id="database-password-hint" className="text-ink-faint">
            {t('admin.auth.secretSet')}
          </span>
        )}
      </div>
      <label className={`${labelClass} sm:col-span-2`}>
        {t('database.ssl')}
        <select
          name="ssl"
          value={ssl}
          onChange={(event) => setSsl(event.target.value as DbSslMode)}
          className={inputClass}
        >
          {DB_SSL_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(`database.ssl_${mode.replace('-', '_')}`)}
            </option>
          ))}
        </select>
      </label>
      {ssl === 'verify-full' && (
        <label className={`${labelClass} sm:col-span-2`}>
          {t('database.sslCa')}
          <textarea
            name="sslCa"
            required
            rows={4}
            placeholder="-----BEGIN CERTIFICATE-----"
            className={`${inputClass} font-mono text-xs`}
          />
        </label>
      )}
    </div>
  );
}

/** Reads DatabaseFields; an empty password is omitted so a stored one is kept. */
export function readDatabaseForm(form: FormData): DatabaseSettingsInput {
  const text = (name: string) => String(form.get(name) ?? '').trim();
  const password = String(form.get('password') ?? '');
  const sslCa = text('sslCa');
  return {
    host: text('host'),
    port: Number(text('port')),
    database: text('database'),
    user: text('user'),
    ...(password ? { password } : {}),
    ssl: text('ssl') as DbSslMode,
    ...(sslCa ? { sslCa } : {}),
    schema: text('schema'),
  };
}

/** Outcome of a connection attempt: success with the server version, or the reason. */
export function ProbeOutcome({ result }: { result: DatabaseProbeResult | undefined }) {
  const { t } = useTranslation();
  if (!result) return null;
  if (result.ok) {
    return (
      <p role="status" className="text-xs text-ink-muted">
        {t('database.connected', { version: result.serverVersion })}
      </p>
    );
  }
  return (
    <div role="alert" className="flex flex-col gap-1 text-xs">
      <span className="text-red-600">{t(`database.errors.${result.error}`)}</span>
      {result.detail && (
        <code className="rounded bg-hover p-2 font-mono break-all text-ink">{result.detail}</code>
      )}
    </div>
  );
}
