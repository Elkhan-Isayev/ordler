import { describe, expect, it } from 'vitest';
import type { DatabaseConfig } from '../config/env.js';
import { toPoolConfig } from './pool-config.js';

const base: DatabaseConfig = { port: 5432, schema: 'ordler', ssl: 'disable', poolMax: 10 };

describe('toPoolConfig', () => {
  it('uses the connection string when given', () => {
    const pool = toPoolConfig({ ...base, connectionString: 'postgres://u:p@h/db' });
    expect(pool.connectionString).toBe('postgres://u:p@h/db');
    expect(pool.host).toBeUndefined();
  });

  it('uses discrete fields otherwise', () => {
    const pool = toPoolConfig({
      ...base,
      host: 'db',
      database: 'ordler',
      user: 'u',
      password: 'p',
    });
    expect(pool).toMatchObject({ host: 'db', port: 5432, database: 'ordler', user: 'u', max: 10 });
  });

  it('pins the search path to the configured schema', () => {
    expect(toPoolConfig({ ...base, host: 'db', schema: 'tasks' }).options).toBe(
      '-c search_path=tasks,public',
    );
  });

  it('maps SSL modes', () => {
    expect(toPoolConfig({ ...base, host: 'db' }).ssl).toBe(false);
    expect(toPoolConfig({ ...base, host: 'db', ssl: 'require' }).ssl).toEqual({
      rejectUnauthorized: false,
    });
    expect(toPoolConfig({ ...base, host: 'db', ssl: 'verify-full', sslCa: 'CA' }).ssl).toEqual({
      rejectUnauthorized: true,
      ca: 'CA',
    });
  });
});
