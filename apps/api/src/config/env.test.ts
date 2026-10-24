import { describe, expect, it } from 'vitest';
import { describeConfig, loadConfig } from './env.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const RDS_CA = '-----BEGIN CERTIFICATE-----\nMIIfake\n-----END CERTIFICATE-----';

describe('loadConfig', () => {
  it('uses an explicit DB_SCHEMA as is', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://u:p@localhost/ordler',
      DB_SCHEMA: 'ordler',
      ENCRYPTION_KEY: KEY,
    });
    expect(config.database).toMatchObject({ schema: 'ordler' });
    expect(config.database?.schemaFromDefault).toBeUndefined();
  });

  it('applies defaults with a connection string', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://u:p@localhost/ordler',
      ENCRYPTION_KEY: KEY,
    });
    expect(config).toMatchObject({
      port: 3000,
      role: 'all',
      migrateOnStart: true,
      defaultLocale: 'en',
      database: {
        connectionString: 'postgres://u:p@localhost/ordler',
        schema: 'public',
        // No DB_SCHEMA: startup may still keep an older install in `ordler`.
        schemaFromDefault: true,
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
        ENCRYPTION_KEY: KEY,
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

  it('leaves the database to the installer when no variables are set', () => {
    const config = loadConfig({});
    expect(config.database).toBeUndefined();
    expect(config.encryptionKey).toBeUndefined();
    expect(config.dataDir).toBe('/data');
    expect(describeConfig(config).database).toBe('installer settings in /data');
  });

  it('treats empty variables as unset', () => {
    const config = loadConfig({
      DATABASE_URL: '',
      ENCRYPTION_KEY: '',
      ORDLER_VERSION: '',
      PORT: '',
    });
    expect(config.database).toBeUndefined();
    expect(config.version).toBeUndefined();
    expect(config.port).toBe(3000);
  });

  it('accepts a fixed install token and web directory', () => {
    const config = loadConfig({
      ORDLER_INSTALL_TOKEN: 'abcd-efgh-ijkl',
      ORDLER_WEB_DIR: '/app/web',
    });
    expect(config).toMatchObject({ installToken: 'abcd-efgh-ijkl', webDir: '/app/web' });
  });

  it('rejects both DATABASE_URL and DB_HOST', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgres://x', DB_HOST: 'db', ENCRYPTION_KEY: KEY }),
    ).toThrow(/not both/);
  });

  it('rejects a variable set both directly and via _FILE', () => {
    expect(() =>
      loadConfig(
        { DB_HOST: 'db', DB_PASS: 'a', DB_PASS_FILE: '/x', ENCRYPTION_KEY: KEY },
        () => 'b',
      ),
    ).toThrow(/DB_PASS or DB_PASS_FILE/);
  });

  it('requires a CA bundle for verify-full', () => {
    expect(() => loadConfig({ DB_HOST: 'db', DB_SSL: 'verify-full', ENCRYPTION_KEY: KEY })).toThrow(
      /DB_SSL_CA/,
    );
  });

  it('rejects unsafe schema names', () => {
    expect(() =>
      loadConfig({ DB_HOST: 'db', DB_SCHEMA: 'public; drop', ENCRYPTION_KEY: KEY }),
    ).toThrow(/DB_SCHEMA/);
  });

  it('rejects unsupported locales', () => {
    expect(() => loadConfig({ DB_HOST: 'db', DEFAULT_LOCALE: 'fr', ENCRYPTION_KEY: KEY })).toThrow(
      /DEFAULT_LOCALE/,
    );
  });
});

describe('secrets and mail', () => {
  const base = { DB_HOST: 'db', ENCRYPTION_KEY: KEY };

  it('requires a 32-byte encryption key when one is given', () => {
    expect(loadConfig({ DB_HOST: 'db' }).encryptionKey).toBeUndefined();
    expect(() =>
      loadConfig({ DB_HOST: 'db', ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/32 bytes/);
    expect(loadConfig(base).encryptionKey).toEqual(Buffer.alloc(32, 7));
  });

  it('reads the encryption key from a file', () => {
    const config = loadConfig({ DB_HOST: 'db', ENCRYPTION_KEY_FILE: '/k' }, () => `${KEY}\n`);
    expect(config.encryptionKey?.length).toBe(32);
  });

  it('leaves SMTP unconfigured by default', () => {
    expect(loadConfig(base).smtp).toBeUndefined();
  });

  it('builds SMTP settings and requires a sender', () => {
    expect(() => loadConfig({ ...base, SMTP_HOST: 'smtp.example.com' })).toThrow(/SMTP_FROM/);
    const config = loadConfig(
      {
        ...base,
        SMTP_HOST: 'smtp.example.com',
        SMTP_FROM: 'Ordler <no-reply@example.com>',
        SMTP_USER: 'mailer',
        SMTP_PASS_FILE: '/smtp',
      },
      () => 'smtp-secret',
    );
    expect(config.smtp).toEqual({
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls',
      verifyTls: true,
      user: 'mailer',
      password: 'smtp-secret',
      from: 'Ordler <no-reply@example.com>',
    });
    expect(JSON.stringify(describeConfig(config))).not.toContain('smtp-secret');
  });
});

describe('version and update check', () => {
  const base = { DB_HOST: 'db', ENCRYPTION_KEY: KEY };

  it('checks the public repository by default', () => {
    const config = loadConfig(base);
    expect(config.updateCheck).toEqual({ enabled: true, repository: 'Elkhan-Isayev/ordler' });
    expect(config.version).toBeUndefined();
  });

  it('can be disabled for air-gapped installs and pointed at a fork', () => {
    const config = loadConfig({
      ...base,
      UPDATE_CHECK: 'false',
      UPDATE_CHECK_REPOSITORY: 'acme/ordler-fork',
      ORDLER_VERSION: '1.4.2',
    });
    expect(config.updateCheck).toEqual({ enabled: false, repository: 'acme/ordler-fork' });
    expect(config.version).toBe('1.4.2');
  });

  it('rejects malformed repositories', () => {
    expect(() => loadConfig({ ...base, UPDATE_CHECK_REPOSITORY: 'https://evil/x' })).toThrow(
      /owner\/repo/,
    );
  });
});

describe('describeConfig', () => {
  it('never exposes passwords or connection strings', () => {
    const fromUrl = describeConfig(
      loadConfig({ DATABASE_URL: 'postgres://u:topsecret@h/db', ENCRYPTION_KEY: KEY }),
    );
    const fromHost = describeConfig(
      loadConfig({ DB_HOST: 'db', DB_PASS: 'topsecret', ENCRYPTION_KEY: KEY }),
    );
    expect(JSON.stringify(fromUrl)).not.toContain('topsecret');
    expect(JSON.stringify(fromHost)).not.toContain('topsecret');
    expect(fromHost).toMatchObject({ database: { target: 'db:5432' } });
  });
});
