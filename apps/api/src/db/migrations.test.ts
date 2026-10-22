import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { findDestructiveStatements } from './migration-lint.js';
import {
  assertNoPendingMigrations,
  checkSchemaCompatibility,
  readJournal,
  SchemaTooNewError,
} from './schema-compat.js';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));
const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as {
  entries: Array<{ idx: number; tag: string; when: number; breakpoints: boolean }>;
};

const tempDirs: string[] = [];
const clients: PGlite[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A migrations folder containing only the first `count` migrations (an older release). */
function folderUpTo(count: number, extra?: { tag: string; sql: string }): string {
  const dir = mkdtempSync(join(tmpdir(), 'ordler-migrations-'));
  tempDirs.push(dir);
  cpSync(join(MIGRATIONS, 'meta'), join(dir, 'meta'), { recursive: true });
  const entries = journal.entries.slice(0, count);
  for (const entry of entries) {
    cpSync(join(MIGRATIONS, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
  }
  if (extra) {
    const last = journal.entries.at(-1)!;
    entries.push({
      idx: entries.length,
      tag: extra.tag,
      when: last.when + 1000,
      breakpoints: true,
    });
    writeFileSync(join(dir, `${extra.tag}.sql`), extra.sql);
  }
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  return dir;
}

async function database() {
  const client = new PGlite();
  clients.push(client);
  return { client, db: drizzle(client) };
}

/** Data an early adopter would have: written with the very first schema. */
async function seedFirstRelease(client: PGlite) {
  await client.exec(`
    insert into departments (id, name) values ('01a13d37-d040-7000-b257-000000000001', 'IT');
    insert into teams (department_id, key, name) values ('01a13d37-d040-7000-b257-000000000001', 'HELP', 'Helpdesk');
    insert into members (id, email, name, status) values ('01a13d37-d040-7000-b257-000000000002', 'ann@push30.test', 'Ann', 'active');
    insert into roles (id, system_key, name) values ('01a13d37-d040-7000-b257-000000000003', 'owner', 'Owner');
    insert into role_permissions (role_id, permission) values ('01a13d37-d040-7000-b257-000000000003', 'org.manage');
    insert into role_assignments (member_id, role_id, scope_type) values ('01a13d37-d040-7000-b257-000000000002', '01a13d37-d040-7000-b257-000000000003', 'organization');
    insert into audit_log (actor_type, action, target_type) values ('system', 'setup.completed', 'instance');
    insert into instance_settings (company_name, base_url, setup_completed_at) values ('Push30', 'https://ordler.test', now());
  `);
}

async function rowCounts(client: PGlite): Promise<Record<string, number>> {
  const tables = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  const counts: Record<string, number> = {};
  for (const { table_name } of tables.rows) {
    const result = await client.query<{ n: number }>(
      `select count(*)::int as n from "${table_name}"`,
    );
    counts[table_name] = result.rows[0]!.n;
  }
  return counts;
}

describe('migration files', () => {
  it.each(readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')))(
    '%s contains no unmarked destructive statements',
    (file) => {
      expect(findDestructiveStatements(readFileSync(join(MIGRATIONS, file), 'utf8'))).toEqual([]);
    },
  );
});

describe('dedicated schema (DB_SCHEMA)', () => {
  it('applies every migration inside a non-public schema, as production does', async () => {
    const { client, db } = await database();
    // Mirrors pool-config: the connection's search_path points at the Ordler schema.
    await client.exec('create schema ordler; set search_path to ordler, public;');
    await migrate(db, { migrationsFolder: MIGRATIONS, migrationsSchema: 'ordler' });
    const tables = await client.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables where table_schema = 'ordler'`,
    );
    expect(tables.rows[0]!.n).toBeGreaterThan(5);
    const leaked = await client.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
    );
    expect(leaked.rows[0]!.n).toBe(0);
  });

  it.each(readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')))(
    '%s never hard-codes the public schema',
    (file) => {
      expect(readFileSync(join(MIGRATIONS, file), 'utf8')).not.toMatch(/"public"\./);
    },
  );
});

describe('upgrades keep data', () => {
  it.each(journal.entries.slice(1).map((entry) => [entry.idx, entry.tag]))(
    'data written before %i (%s) survives it',
    async (index) => {
      const { client, db } = await database();
      await migrate(db, { migrationsFolder: folderUpTo(index as number) });
      await seedFirstRelease(client);
      const before = await rowCounts(client);

      await migrate(db, { migrationsFolder: folderUpTo((index as number) + 1) });
      const after = await rowCounts(client);
      for (const [table, count] of Object.entries(before)) {
        expect(after[table], table).toBeGreaterThanOrEqual(count);
      }
    },
  );

  it('upgrades the first release straight to the latest with every row intact', async () => {
    const { client, db } = await database();
    await migrate(db, { migrationsFolder: folderUpTo(1) });
    await seedFirstRelease(client);
    await migrate(db, { migrationsFolder: MIGRATIONS });

    const member = await client.query(`select email, name, status from members`);
    expect(member.rows).toEqual([{ email: 'ann@push30.test', name: 'Ann', status: 'active' }]);
    const team = await client.query(`select key from teams`);
    expect(team.rows).toEqual([{ key: 'HELP' }]);
    const grants = await client.query(`select count(*)::int as n from role_assignments`);
    expect(grants.rows).toEqual([{ n: 1 }]);
  });

  it('keeps existing assignees when issues gain several (0014)', async () => {
    const { client, db } = await database();
    const before = journal.entries.findIndex((e) => e.tag === '0014_multiple_assignees');
    await migrate(db, { migrationsFolder: folderUpTo(before) });
    await seedFirstRelease(client);
    await client.exec(`
      insert into workflows (id, owner_type, owner_id)
        select '01a13d37-d040-7000-b257-000000000010', 'team', id from teams where key = 'HELP';
      insert into workflow_statuses (id, workflow_id, name, category, position)
        values ('01a13d37-d040-7000-b257-000000000011', '01a13d37-d040-7000-b257-000000000010', 'Todo', 'unstarted', 0);
      insert into issues (team_id, number, title, status_id, assignee_id)
        select id, 1, 'Assigned', '01a13d37-d040-7000-b257-000000000011', '01a13d37-d040-7000-b257-000000000002'
        from teams where key = 'HELP';
      insert into issues (team_id, number, title, status_id)
        select id, 2, 'Nobody', '01a13d37-d040-7000-b257-000000000011' from teams where key = 'HELP';
    `);
    await migrate(db, { migrationsFolder: MIGRATIONS });
    const rows = await client.query(
      `select i.number, a.member_id, a.position from issue_assignees a join issues i on i.id = a.issue_id`,
    );
    expect(rows.rows).toEqual([
      { number: 1, member_id: '01a13d37-d040-7000-b257-000000000002', position: 0 },
    ]);
  });

  it('rolls back every pending migration when one fails, leaving data untouched', async () => {
    const { client, db } = await database();
    await migrate(db, { migrationsFolder: folderUpTo(1) });
    await seedFirstRelease(client);
    const before = await rowCounts(client);
    const appliedBefore = await client.query(
      `select count(*)::int as n from drizzle.__drizzle_migrations`,
    );

    const broken = folderUpTo(journal.entries.length, {
      tag: '9999_broken',
      sql: 'create table should_not_exist (id int);\n--> statement-breakpoint\nselect 1/0;',
    });
    await expect(migrate(db, { migrationsFolder: broken })).rejects.toThrow();

    expect(await rowCounts(client)).toEqual(before);
    expect((await client.query(`select to_regclass('should_not_exist') as t`)).rows[0]).toEqual({
      t: null,
    });
    expect(
      (await client.query(`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows,
    ).toEqual(appliedBefore.rows);
  });
});

describe('checkSchemaCompatibility', () => {
  const bundled = readJournal(MIGRATIONS);

  it('reports every migration pending on an empty database', async () => {
    const { client } = await database();
    expect(await checkSchemaCompatibility(client, 'drizzle', bundled)).toEqual({
      applied: 0,
      pending: bundled,
    });
  });

  it('reports what an older schema still needs', async () => {
    const { client, db } = await database();
    await migrate(db, { migrationsFolder: folderUpTo(1) });
    const result = await checkSchemaCompatibility(client, 'drizzle', bundled);
    expect(result.applied).toBe(1);
    expect(result.pending.map((m) => m.tag)).toEqual(bundled.slice(1).map((m) => m.tag));
    expect(() => assertNoPendingMigrations(result.pending)).toThrow(/pending/);
  });

  it('accepts an up-to-date schema', async () => {
    const { client, db } = await database();
    await migrate(db, { migrationsFolder: MIGRATIONS });
    const result = await checkSchemaCompatibility(client, 'drizzle', bundled);
    expect(result.pending).toEqual([]);
    expect(() => assertNoPendingMigrations(result.pending)).not.toThrow();
  });

  it('refuses to run old code on a schema migrated by a newer version', async () => {
    const { client, db } = await database();
    await migrate(db, {
      migrationsFolder: folderUpTo(journal.entries.length, {
        tag: '9999_future',
        sql: 'create table future_feature (id int);',
      }),
    });
    await expect(checkSchemaCompatibility(client, 'drizzle', bundled)).rejects.toBeInstanceOf(
      SchemaTooNewError,
    );
  });
});

describe('findDestructiveStatements', () => {
  it.each([
    ['ALTER TABLE "members" DROP COLUMN "name";', 'drop'],
    ['DROP TABLE "teams";', 'drop'],
    ['TRUNCATE sessions;', 'truncate'],
    ['DELETE FROM members WHERE true;', 'delete'],
    ['ALTER TABLE "teams" RENAME COLUMN "key" TO "code";', 'rename'],
    ['ALTER TABLE members ALTER COLUMN email SET DATA TYPE varchar(10);', 'retype'],
  ])('flags %s', (sql, rule) => {
    expect(findDestructiveStatements(sql)).toEqual([expect.objectContaining({ rule, line: 1 })]);
  });

  it('allows additive changes and comments', () => {
    expect(
      findDestructiveStatements(
        'CREATE TABLE x (id int);\nALTER TABLE x ADD COLUMN y text;\n-- DROP TABLE x; (comment only)',
      ),
    ).toEqual([]);
  });

  it('accepts an explicit, justified marker', () => {
    expect(
      findDestructiveStatements(
        '-- ordler:allow-destructive column unused since 2.0, data copied in 0042\nALTER TABLE x DROP COLUMN y;',
      ),
    ).toEqual([]);
    expect(findDestructiveStatements('-- ordler:allow-destructive\nDROP TABLE x;')).toHaveLength(1);
  });
});
