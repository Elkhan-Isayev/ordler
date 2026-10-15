import { describe, expect, it } from 'vitest';
import {
  emailDomainSchema,
  emailSchema,
  isEmailDomainAllowed,
  otpVerifySchema,
  passwordSchema,
  setupSchema,
  updateAuthStrategySchema,
} from './auth.js';

describe('emailSchema', () => {
  it('normalises case and whitespace', () => {
    expect(emailSchema.parse('  Ann@Company.COM ')).toBe('ann@company.com');
  });

  it('rejects malformed addresses', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('accepts a long enough password', () => {
    expect(passwordSchema.safeParse('correct horse battery').success).toBe(true);
  });

  it.each([
    ['short', 'password_too_short'],
    [' leading-space-pw', 'password_whitespace_edges'],
    ['x'.repeat(257), 'password_too_long'],
  ])('rejects %j with %s', (password, code) => {
    const result = passwordSchema.safeParse(password);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(code);
  });
});

describe('setupSchema', () => {
  it('validates the wizard payload', () => {
    const parsed = setupSchema.parse({
      companyName: ' Push30 ',
      defaultLocale: 'az',
      owner: { name: 'Owner', email: 'OWNER@push30.com', password: 'a-strong-password' },
    });
    expect(parsed.companyName).toBe('Push30');
    expect(parsed.owner.email).toBe('owner@push30.com');
  });

  it('rejects unsupported locales', () => {
    expect(
      setupSchema.safeParse({
        companyName: 'X',
        defaultLocale: 'fr',
        owner: { name: 'O', email: 'o@x.com', password: 'a-strong-password' },
      }).success,
    ).toBe(false);
  });
});

describe('otpVerifySchema', () => {
  it('accepts six digits', () => {
    expect(otpVerifySchema.safeParse({ email: 'a@b.co', code: '012345' }).success).toBe(true);
  });

  it.each(['12345', '1234567', '12a456'])('rejects %s', (code) => {
    expect(otpVerifySchema.safeParse({ email: 'a@b.co', code }).success).toBe(false);
  });
});

describe('emailDomainSchema', () => {
  it('normalises domains', () => {
    expect(emailDomainSchema.parse(' @Company.COM ')).toBe('company.com');
  });

  it.each(['company', 'com.', 'exa mple.com'])('rejects %s', (domain) => {
    expect(emailDomainSchema.safeParse(domain).success).toBe(false);
  });
});

describe('isEmailDomainAllowed', () => {
  it('allows any domain when the list is empty', () => {
    expect(isEmailDomainAllowed('x@gmail.com', [])).toBe(true);
  });

  it('matches the exact domain only (MVP acceptance criterion 7)', () => {
    expect(isEmailDomainAllowed('ann@company.com', ['company.com'])).toBe(true);
    expect(isEmailDomainAllowed('ann@gmail.com', ['company.com'])).toBe(false);
    expect(isEmailDomainAllowed('ann@evil-company.com', ['company.com'])).toBe(false);
    expect(isEmailDomainAllowed('ann@sub.company.com', ['company.com'])).toBe(false);
  });
});

describe('updateAuthStrategySchema', () => {
  it('accepts partial updates', () => {
    expect(updateAuthStrategySchema.parse({ enabled: true })).toEqual({ enabled: true });
  });

  it('normalises allowed domains', () => {
    expect(updateAuthStrategySchema.parse({ allowedDomains: ['@Company.com'] })).toEqual({
      allowedDomains: ['company.com'],
    });
  });
});
