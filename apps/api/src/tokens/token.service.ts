import {
  can,
  ORGANIZATION_SCOPE,
  PERSONAL_TOKEN_PREFIX,
  type CreatedToken,
  type CreateTokenInput,
  type Permission,
  type PersonalTokenView,
  type TokenScope,
  type TokenSettings,
} from '@ordler/shared';
import { and, desc, eq } from 'drizzle-orm';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import { randomToken, sha256 } from '../crypto/tokens.js';
import type { Db } from '../db/client.js';
import { instanceSettings, members, personalTokens } from '../db/schema.js';
import type { AccessContextSource, MemberAccess } from '../rbac/permission.guard.js';

/** Characters of the secret kept in clear so people can tell their tokens apart. */
const VISIBLE_CHARS = 4;
/** last_used_at only needs minute-level accuracy; avoids a write per MCP call. */
const TOUCH_INTERVAL_MS = 60_000;

export interface ResolvedToken {
  tokenId: string;
  memberId: string;
  name: string;
  scopes: TokenScope[];
}

type Row = typeof personalTokens.$inferSelect;

/** A role grants the permission somewhere: team-scoped members may still create tokens. */
export function holdsAnywhere(access: MemberAccess, permission: Permission): boolean {
  return access.assignments.some((a) => access.rolePermissions(a.roleId)?.includes(permission));
}

/**
 * Personal access tokens (SPEC §10.1). Members manage their own; org admins may list and
 * revoke any. Only the SHA-256 of the secret is stored, so a token is shown exactly once.
 */
export class TokenService {
  constructor(
    private readonly db: Db,
    private readonly access: AccessContextSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async settings(): Promise<TokenSettings> {
    const [row] = await this.db.select().from(instanceSettings).limit(1);
    return {
      mcpEnabled: row?.mcpEnabled ?? true,
      maxExpiryDays: row?.tokenMaxExpiryDays ?? 365,
      allowNoExpiry: row?.tokenAllowNoExpiry ?? false,
    };
  }

  async updateSettings(memberId: string, input: TokenSettings): Promise<TokenSettings> {
    await this.assertAdmin(memberId);
    const before = await this.settings();
    await this.db.update(instanceSettings).set({
      mcpEnabled: input.mcpEnabled,
      tokenMaxExpiryDays: input.maxExpiryDays,
      tokenAllowNoExpiry: input.allowNoExpiry,
    });
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action: 'tokens.settings_updated',
      targetType: 'instance',
      before,
      after: input,
    });
    return this.settings();
  }

  async create(memberId: string, input: CreateTokenInput): Promise<CreatedToken> {
    const access = await this.access.load(memberId);
    if (!holdsAnywhere(access, 'token.create_personal')) throw new DomainError('forbidden');
    const settings = await this.settings();
    const days = input.expiresInDays === undefined ? 90 : input.expiresInDays;
    if (days === null ? !settings.allowNoExpiry : days > settings.maxExpiryDays) {
      throw new DomainError('token_expiry_too_long');
    }
    const secret = `${PERSONAL_TOKEN_PREFIX}${randomToken()}`;
    const [row] = await this.db
      .insert(personalTokens)
      .values({
        memberId,
        name: input.name,
        prefix: secret.slice(0, PERSONAL_TOKEN_PREFIX.length + VISIBLE_CHARS),
        tokenHash: sha256(secret),
        scopes: [...new Set(input.scopes)],
        expiresAt: days === null ? null : new Date(this.now().getTime() + days * 86_400_000),
      })
      .returning();
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action: 'personal_token.created',
      targetType: 'personal_token',
      targetId: row!.id,
      after: { name: row!.name, scopes: row!.scopes, expiresAt: row!.expiresAt },
    });
    return { token: secret, view: this.view(row!) };
  }

  async list(memberId: string): Promise<PersonalTokenView[]> {
    const rows = await this.db
      .select()
      .from(personalTokens)
      .where(eq(personalTokens.memberId, memberId))
      .orderBy(desc(personalTokens.createdAt));
    return rows.map((row) => this.view(row));
  }

  async listAll(adminId: string): Promise<PersonalTokenView[]> {
    await this.assertAdmin(adminId);
    const rows = await this.db
      .select({ token: personalTokens, name: members.name })
      .from(personalTokens)
      .innerJoin(members, eq(members.id, personalTokens.memberId))
      .orderBy(desc(personalTokens.createdAt));
    return rows.map(({ token, name }) => ({
      ...this.view(token),
      member: { id: token.memberId, name },
    }));
  }

  /** Own tokens; org admins may revoke anyone's. */
  async revoke(memberId: string, id: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [row] = await this.db.select().from(personalTokens).where(eq(personalTokens.id, id));
    if (!row) throw new DomainError('not_found');
    if (row.memberId !== memberId) await this.assertAdmin(memberId);
    if (row.revokedAt) return;
    await this.db
      .update(personalTokens)
      .set({ revokedAt: this.now(), revokedBy: memberId })
      .where(eq(personalTokens.id, id));
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action: 'personal_token.revoked',
      targetType: 'personal_token',
      targetId: id,
      before: { name: row.name, memberId: row.memberId },
    });
  }

  /** The token behind an `Authorization: Bearer` header, if it is still valid. */
  async resolve(secret: string, ip?: string): Promise<ResolvedToken | undefined> {
    if (!secret.startsWith(PERSONAL_TOKEN_PREFIX)) return undefined;
    const [found] = await this.db
      .select({ token: personalTokens, status: members.status })
      .from(personalTokens)
      .innerJoin(members, eq(members.id, personalTokens.memberId))
      .where(eq(personalTokens.tokenHash, sha256(secret)));
    if (!found || found.status !== 'active') return undefined;
    const { token } = found;
    const now = this.now();
    if (token.revokedAt || (token.expiresAt && token.expiresAt <= now)) return undefined;
    if (!token.lastUsedAt || now.getTime() - token.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.db
        .update(personalTokens)
        .set({ lastUsedAt: now, lastUsedIp: ip ?? null })
        .where(and(eq(personalTokens.id, token.id)));
    }
    return {
      tokenId: token.id,
      memberId: token.memberId,
      name: token.name,
      scopes: token.scopes as TokenScope[],
    };
  }

  private async assertAdmin(memberId: string): Promise<void> {
    const access = await this.access.load(memberId);
    const allowed = can(
      access.assignments,
      access.rolePermissions,
      'org.manage',
      ORGANIZATION_SCOPE,
      access.directory,
    );
    if (!allowed) throw new DomainError('forbidden');
  }

  private view(row: Row): PersonalTokenView {
    return {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scopes: row.scopes as TokenScope[],
      expiresAt: row.expiresAt?.toISOString() ?? null,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      lastUsedIp: row.lastUsedIp,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
