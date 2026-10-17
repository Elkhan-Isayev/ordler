import { describe, expect, it } from 'vitest';
import { databaseSettingsSchema, installDatabaseSchema } from './database.js';

const valid = {
  host: ' db.company.test ',
  port: 5432,
  database: 'ordler',
  user: 'ordler',
  password: 'secret',
  ssl: 'require',
  schema: 'ordler',
};

describe('databaseSettingsSchema', () => {
  it('accepts a typical RDS connection', () => {
    expect(databaseSettingsSchema.parse(valid).host).toBe('db.company.test');
  });

  it('requires a CA certificate for verify-full', () => {
    const result = databaseSettingsSchema.safeParse({ ...valid, ssl: 'verify-full' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ['sslCa'], message: 'ssl_ca_required' });
    expect(
      databaseSettingsSchema.safeParse({ ...valid, ssl: 'verify-full', sslCa: '-----BEGIN' })
        .success,
    ).toBe(true);
  });

  it.each([
    ['schema with uppercase', { schema: 'Ordler' }],
    ['schema with a quote', { schema: 'x"; drop' }],
    ['port zero', { port: 0 }],
    ['empty database', { database: '' }],
  ])('rejects %s', (_label, patch) => {
    expect(databaseSettingsSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('installDatabaseSchema', () => {
  it('requires the install token', () => {
    expect(installDatabaseSchema.safeParse(valid).success).toBe(false);
    expect(installDatabaseSchema.safeParse({ ...valid, installToken: 'ABCD-EFGH' }).success).toBe(
      true,
    );
  });
});
