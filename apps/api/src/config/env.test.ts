import { describe, expect, it } from 'vitest';
import { ConfigError, describeConfig, loadConfig } from './env.js';

const RDS_CA = '-----BEGIN CERTIFICATE-----\nMIIfake\n-----END CERTIFICATE-----';

describe('loadConfig', () => {
  it('applies defaults with a connection string', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://u:p@localhost/ordler' });
    expect(config).toMatchObject({
      port: 3000,
      role: 'all',
      migrateOnStart: true,
      defaultLocale: 'en',
      database: {
        connectionString: 'postgres://u:p@localhost/ordler',
        schema: 'ordler',
        ssl: 'disable',
        poolMax: 20,
      },
    });
  });

  it('builds an RDS config from discrete variables and mounted secret files', () => {
    const files: Record<string, string> = {
      '/run/secrets/db-pass': 's3cret\n',
      '/run/secrets/rds-ca.pem': RDS_CA,
    };
    const config = loadConfig(
      {
        DB_HOST: 'ordler.abc123.eu-central-1.rds.amazonaws.com',
        DB_NAME: 'ordler',
        DB_USER: 'ordler',
        DB_PASS_FILE: '/run/secrets/db-pass',
        DB_SSL: 'verify-full',
        DB_SSL_CA_FILE: '/run/secrets/rds-ca.pem',
        ORDLER_MIGRATE: 'false',
        BASE_URL: 'https://tasks.example.com/',
      },
      (path) => files[path] ?? '',
    );
    expect(config.database).toMatchObject({
      host: 'ordler.abc123.eu-central-1.rds.amazonaws.com',
      password: 's3cret',
      ssl: 'verify-full',
      sslCa: RDS_CA,
    });
    expect(config.migrateOnStart).toBe(false);
    expect(config.baseUrl).toBe('https://tasks.example.com');
  });

  it('rejects a missing database', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it('rejects both DATABASE_URL and DB_HOST', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', DB_HOST: 'db' })).toThrow(/not both/);
  });

  it('rejects a variable set both directly and via _FILE', () => {
    expect(() =>
      loadConfig({ DB_HOST: 'db', DB_PASS: 'a', DB_PASS_FILE: '/x' }, () => 'b'),
    ).toThrow(/DB_PASS or DB_PASS_FILE/);
  });

  it('requires a CA bundle for verify-full', () => {
    expect(() => loadConfig({ DB_HOST: 'db', DB_SSL: 'verify-full' })).toThrow(/DB_SSL_CA/);
  });

  it('rejects unsafe schema names', () => {
    expect(() => loadConfig({ DB_HOST: 'db', DB_SCHEMA: 'public; drop' })).toThrow(/DB_SCHEMA/);
  });

  it('rejects unsupported locales', () => {
    expect(() => loadConfig({ DB_HOST: 'db', DEFAULT_LOCALE: 'fr' })).toThrow(/DEFAULT_LOCALE/);
  });
});

describe('describeConfig', () => {
  it('never exposes passwords or connection strings', () => {
    const fromUrl = describeConfig(loadConfig({ DATABASE_URL: 'postgres://u:topsecret@h/db' }));
    const fromHost = describeConfig(loadConfig({ DB_HOST: 'db', DB_PASS: 'topsecret' }));
    expect(JSON.stringify(fromUrl)).not.toContain('topsecret');
    expect(JSON.stringify(fromHost)).not.toContain('topsecret');
    expect(fromHost).toMatchObject({ database: { target: 'db:5432' } });
  });
});
