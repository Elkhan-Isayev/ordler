import {
  AUTH_STRATEGY_KINDS,
  type AuthStrategyKind,
  type UpdateAuthStrategyInput,
} from '@ordler/shared';
import { asc, eq } from 'drizzle-orm';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import type { SecretBox } from '../crypto/secret-box.js';
import type { Db } from '../db/client.js';
import { authStrategies, memberIdentities, memberPasswords } from '../db/schema.js';
import { roleExists } from '../setup/system-roles.js';
import { DomainError } from './errors.js';

export interface StrategyConfig {
  clientId?: string;
  hostedDomain?: string | null;
}

interface StrategySecrets {
  clientSecret?: string;
}

export interface AuthStrategy {
  kind: AuthStrategyKind;
  enabled: boolean;
  position: number;
  displayName: string | null;
  allowSelfRegistration: boolean;
  allowedDomains: string[];
  defaultRoleId: string | null;
  config: StrategyConfig;
  hasClientSecret: boolean;
}

/** Admin view: like AuthStrategy, never carrying secret values (SPEC §8.1). */
export type AuthStrategyView = AuthStrategy;

const DEFAULTS: Record<AuthStrategyKind, { enabled: boolean; position: number }> = {
  local: { enabled: true, position: 0 },
  email_otp: { enabled: false, position: 1 },
  google: { enabled: false, position: 2 },
};

type Row = typeof authStrategies.$inferSelect;

/** Whether outgoing mail works right now; email OTP depends on it. */
export interface MailStatus {
  isConfigured(): Promise<boolean>;
}

export class StrategyService {
  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly mail: MailStatus,
  ) {}

  /** Creates the three Phase 1 strategies once; local sign-in starts enabled for the first Owner. */
  async ensureDefaults(): Promise<void> {
    await this.db
      .insert(authStrategies)
      .values(AUTH_STRATEGY_KINDS.map((kind) => ({ kind, ...DEFAULTS[kind] })))
      .onConflictDoNothing();
  }

  async list(): Promise<AuthStrategy[]> {
    const rows = await this.db.select().from(authStrategies).orderBy(asc(authStrategies.position));
    return rows.map((row) => this.toStrategy(row));
  }

  async get(kind: AuthStrategyKind): Promise<AuthStrategy | undefined> {
    const [row] = await this.db.select().from(authStrategies).where(eq(authStrategies.kind, kind));
    return row ? this.toStrategy(row) : undefined;
  }

  /** Enabled and actually usable right now; this is what the sign-in page renders. */
  async usable(): Promise<AuthStrategy[]> {
    const strategies = await this.list();
    const usable = await Promise.all(strategies.map((strategy) => this.isUsable(strategy)));
    return strategies.filter((_, index) => usable[index]);
  }

  async requireUsable(kind: AuthStrategyKind): Promise<AuthStrategy> {
    const strategy = await this.get(kind);
    if (!strategy || !(await this.isUsable(strategy))) throw new DomainError('strategy_disabled');
    return strategy;
  }

  async isUsable(strategy: AuthStrategy): Promise<boolean> {
    if (!strategy.enabled) return false;
    if (strategy.kind === 'email_otp') return this.mail.isConfigured();
    if (strategy.kind === 'google')
      return Boolean(strategy.config.clientId && strategy.hasClientSecret);
    return true;
  }

  async clientSecret(kind: AuthStrategyKind): Promise<string | undefined> {
    const [row] = await this.db
      .select({ sealed: authStrategies.secretsEncrypted })
      .from(authStrategies)
      .where(eq(authStrategies.kind, kind));
    return this.openSecrets(kind, row?.sealed ?? null).clientSecret;
  }

  async update(
    kind: AuthStrategyKind,
    input: UpdateAuthStrategyInput,
    actor: AuditActor & { id: string },
    currentSessionStrategy: AuthStrategyKind,
  ): Promise<AuthStrategy> {
    const [row] = await this.db.select().from(authStrategies).where(eq(authStrategies.kind, kind));
    if (!row) throw new Error(`Unknown strategy ${kind}`);
    const before = this.toStrategy(row);

    const secrets = { ...this.openSecrets(kind, row.secretsEncrypted), ...input.secrets };
    const config: StrategyConfig = { ...(row.config as StrategyConfig), ...input.config };
    const next: AuthStrategy = {
      ...before,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.allowSelfRegistration !== undefined
        ? { allowSelfRegistration: input.allowSelfRegistration }
        : {}),
      ...(input.allowedDomains !== undefined
        ? { allowedDomains: [...new Set(input.allowedDomains)] }
        : {}),
      ...(input.defaultRoleId !== undefined ? { defaultRoleId: input.defaultRoleId } : {}),
      config,
      hasClientSecret: Boolean(secrets.clientSecret),
    };

    if (next.defaultRoleId && !(await roleExists(this.db, next.defaultRoleId))) {
      throw new DomainError('validation_failed');
    }
    if (next.enabled && !(await this.isUsable(next))) {
      throw new DomainError(
        kind === 'email_otp' ? 'mail_not_configured' : 'strategy_disabled',
        409,
      );
    }
    if (before.enabled && !next.enabled) {
      await this.assertNoLockout(kind, actor.id, currentSessionStrategy);
    }

    await this.db
      .update(authStrategies)
      .set({
        enabled: next.enabled,
        position: next.position,
        displayName: next.displayName,
        allowSelfRegistration: next.allowSelfRegistration,
        allowedDomains: next.allowedDomains,
        defaultRoleId: next.defaultRoleId,
        config: { ...config },
        secretsEncrypted:
          Object.keys(secrets).length > 0
            ? this.box.encrypt(JSON.stringify(secrets), aad(kind))
            : null,
        updatedAt: new Date(),
      })
      .where(eq(authStrategies.kind, kind));

    await writeAudit(this.db, {
      actor,
      action: 'auth_strategy.updated',
      targetType: 'auth_strategy',
      targetId: row.id,
      before,
      after: { ...next, secretsChanged: input.secrets?.clientSecret !== undefined },
    });
    return next;
  }

  /**
   * At least one strategy must stay enabled, and an admin cannot switch off the strategy they
   * are signed in with unless another enabled strategy works for them (SPEC §8.1).
   */
  private async assertNoLockout(
    disabling: AuthStrategyKind,
    memberId: string,
    currentSessionStrategy: AuthStrategyKind,
  ): Promise<void> {
    const remaining = (await this.usable()).filter((s) => s.kind !== disabling);
    if (remaining.length === 0) throw new DomainError('lockout_prevented');
    if (disabling !== currentSessionStrategy) return;

    for (const strategy of remaining) {
      if (strategy.kind === 'email_otp') return;
      if (strategy.kind === 'local') {
        const [password] = await this.db
          .select({ id: memberPasswords.memberId })
          .from(memberPasswords)
          .where(eq(memberPasswords.memberId, memberId));
        if (password) return;
      }
      if (strategy.kind === 'google') {
        const [identity] = await this.db
          .select({ id: memberIdentities.id })
          .from(memberIdentities)
          .where(eq(memberIdentities.memberId, memberId));
        if (identity) return;
      }
    }
    throw new DomainError('lockout_prevented');
  }

  private openSecrets(kind: AuthStrategyKind, sealed: string | null): StrategySecrets {
    if (!sealed) return {};
    const json = this.box.decrypt(sealed, aad(kind));
    return json ? (JSON.parse(json) as StrategySecrets) : {};
  }

  private toStrategy(row: Row): AuthStrategy {
    return {
      kind: row.kind,
      enabled: row.enabled,
      position: row.position,
      displayName: row.displayName,
      allowSelfRegistration: row.allowSelfRegistration,
      allowedDomains: row.allowedDomains,
      defaultRoleId: row.defaultRoleId,
      config: row.config as StrategyConfig,
      hasClientSecret: Boolean(this.openSecrets(row.kind, row.secretsEncrypted).clientSecret),
    };
  }
}

function aad(kind: AuthStrategyKind): string {
  return `auth_strategy:${kind}`;
}
