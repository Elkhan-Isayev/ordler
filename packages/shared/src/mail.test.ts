import { describe, expect, it } from 'vitest';
import { sendTestMailSchema, updateMailSettingsSchema } from './mail.js';

const valid = {
  host: ' smtp.company.test ',
  port: 587,
  security: 'starttls',
  verifyTls: true,
  username: 'ordler',
  fromName: 'Ordler',
  fromEmail: 'No-Reply@Company.test',
};

describe('updateMailSettingsSchema', () => {
  it('normalises host and sender address', () => {
    const parsed = updateMailSettingsSchema.parse(valid);
    expect(parsed.host).toBe('smtp.company.test');
    expect(parsed.fromEmail).toBe('no-reply@company.test');
    expect(parsed.password).toBeUndefined();
  });

  it('accepts null to clear the stored password', () => {
    expect(updateMailSettingsSchema.parse({ ...valid, password: null }).password).toBeNull();
  });

  it.each([
    ['port out of range', { port: 70000 }],
    ['unknown security mode', { security: 'ssl' }],
    ['missing host', { host: ' ' }],
    ['malformed sender', { fromEmail: 'nobody' }],
  ])('rejects %s', (_label, patch) => {
    expect(updateMailSettingsSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('sendTestMailSchema', () => {
  it('requires a valid recipient', () => {
    expect(sendTestMailSchema.safeParse({ to: 'admin@company.test' }).success).toBe(true);
    expect(sendTestMailSchema.safeParse({ to: 'admin' }).success).toBe(false);
  });
});
