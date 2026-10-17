import { randomBytes } from 'node:crypto';
import { StrategyService } from '../auth/strategies.js';
import type { Argon2Params } from '../crypto/password.js';
import { SecretBox } from '../crypto/secret-box.js';
import type { Db } from '../db/client.js';
import { SetupService } from '../setup/setup.service.js';

/** Fast Argon2 parameters for tests; production defaults are tested in crypto.test.ts. */
export const FAST_ARGON2: Argon2Params = { memory: 1024, passes: 1, parallelism: 1 };

export const OWNER = {
  name: 'Owner',
  email: 'owner@push30.test',
  password: 'owner-password-123',
};

export function testBox(): SecretBox {
  return new SecretBox(randomBytes(32));
}

export async function completeSetup(db: Db): Promise<string> {
  const setup = new SetupService(db, 'https://ordler.test', FAST_ARGON2);
  const { ownerId } = await setup.completeSetup({
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  return ownerId;
}

export async function strategiesFor(
  db: Db,
  options: { mail?: boolean; box?: SecretBox } = {},
): Promise<StrategyService> {
  const mail = { isConfigured: async () => options.mail ?? true };
  const service = new StrategyService(db, options.box ?? testBox(), mail);
  await service.ensureDefaults();
  return service;
}

/** Mutable clock for expiry tests. */
export function testClock(start = new Date('2026-10-15T09:00:00Z')) {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}
