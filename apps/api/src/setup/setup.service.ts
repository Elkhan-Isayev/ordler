import { isLocale, SOURCE_LOCALE, type Locale, type SetupInput } from '@ordler/shared';
import { sql } from 'drizzle-orm';
import { SYSTEM_ACTOR, writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import { hashPassword, type Argon2Params } from '../crypto/password.js';
import type { Db } from '../db/client.js';
import { instanceSettings, memberPasswords, members, roleAssignments } from '../db/schema.js';
import { syncSystemRoles } from './system-roles.js';

/** Serialises concurrent setup submissions across replicas. */
const SETUP_LOCK_KEY = 4_206_660_002;

export interface Instance {
  companyName: string;
  baseUrl: string;
  defaultLocale: Locale;
}

export async function getInstance(db: Db): Promise<Instance | undefined> {
  const [row] = await db.select().from(instanceSettings).limit(1);
  if (!row?.setupCompletedAt) return undefined;
  return {
    companyName: row.companyName,
    baseUrl: row.baseUrl,
    defaultLocale: isLocale(row.defaultLocale) ? row.defaultLocale : SOURCE_LOCALE,
  };
}

export class SetupService {
  constructor(
    private readonly db: Db,
    private readonly baseUrl: string,
    private readonly argon2?: Argon2Params,
  ) {}

  async isSetupRequired(): Promise<boolean> {
    return (await getInstance(this.db)) === undefined;
  }

  /**
   * First-run wizard (SPEC §16.4): stores instance settings and creates the first Owner with a
   * password. Only ever succeeds once.
   */
  async completeSetup(input: SetupInput): Promise<{ ownerId: string }> {
    const passwordHash = await hashPassword(input.owner.password, this.argon2);

    return this.db.transaction(async (tx) => {
      const db = tx as unknown as Db;
      await db.execute(sql`select pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);
      if (await getInstance(db)) throw new DomainError('setup_completed');

      const roleIds = await syncSystemRoles(db);
      await db.insert(instanceSettings).values({
        companyName: input.companyName,
        baseUrl: this.baseUrl,
        defaultLocale: input.defaultLocale,
        setupCompletedAt: new Date(),
      });
      const [owner] = await db
        .insert(members)
        .values({
          email: input.owner.email,
          name: input.owner.name,
          locale: input.defaultLocale,
          status: 'active',
          emailVerifiedAt: new Date(),
        })
        .returning({ id: members.id });
      const ownerId = owner!.id;
      await db.insert(memberPasswords).values({ memberId: ownerId, hash: passwordHash });
      await db.insert(roleAssignments).values({
        memberId: ownerId,
        roleId: roleIds.owner,
        scopeType: 'organization',
        scopeId: null,
      });
      await writeAudit(db, {
        actor: SYSTEM_ACTOR,
        action: 'setup.completed',
        targetType: 'instance',
        after: { companyName: input.companyName, defaultLocale: input.defaultLocale, ownerId },
      });
      return { ownerId };
    });
  }
}
